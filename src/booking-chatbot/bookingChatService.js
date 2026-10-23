import Anthropic from "@anthropic-ai/sdk";
import { buildBookingSystemPrompt, NO_REPLY_SENTINEL, HANDOFF_SENTINEL } from "./bookingSystemPrompt.js";
import {
  bookingClaudeTools,
  bookingClaudeToolsWhatsapp,
  executeBookingTool,
} from "./bookingToolRegistry.js";
import { isExplicitConfirmation } from "./tools/reservation.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Subido de Haiku 4.5 a Sonnet 5.5 el 2026-10-23: en una comparación con 20
// conversaciones reales de 13 negocios + 11 casos de Diana Vargas, Haiku 4.5 tuvo
// 5 errores serios (fechas inventadas, aceptar días pasados, perder el "sí" del
// cliente) y Sonnet 5.5 0-1, verificando disponibilidad antes de afirmar. Costo
// ~2,7x (≈ +15 USD/mes al volumen actual). El asistente del panel
// (src/chatbot/chatService.js) y el validador de comprobantes siguen en Haiku 4.5.
const MODEL = "claude-sonnet-5-5";
// Sonnet 5.5 cuenta las notas que escribe entre tools (bloques thinking) dentro de
// max_tokens; con 1024 una respuesta con varias tools podía cortarse.
const MAX_TOKENS = 4096;
const MAX_TOOL_ROUNDS = 8;

// Detecta cuando el bot afirma que la reserva fue confirmada/procesada sin haber
// llamado prepare_reservation. Cubre "reserva confirmada", tiempo pasado del verbo
// ("reservé", "agendé") y el mensaje del botón que solo debe decirse DESPUÉS de la tool.
const BOOKING_HALLUCINATION_PATTERN =
  /\b(reserva|turno|cita)\b.{0,150}\b(confirmad[ao]|procesad[ao]|cread[ao]|agendad[ao]|registrad[ao]|complet[ao]|exitosa|realizada)\b|\bbotón\b.{0,80}\b(confirmar|verificar)\b|haz clic.{0,60}(confirmar|s[ií])|\b(reservé|agendé|confirmé)(?![\wáéíóúñ])/i;

// Afirma que una cita YA EXISTENTE fue movida o cancelada. Caso real (Dulce Maria
// Spa, 2026-09-10): "¡Listo! He movido ambas citas" sin haber llamado
// reschedule_appointment — la clienta quedó creyendo que su cita cambió.
const EXISTING_APPOINTMENT_CLAIM_PATTERN =
  /\b(he|ya|hemos)\s+(movido|reprogramado|cambiado|corrido|adelantado|cancelado|anulado)\b|\b(cita|citas|turno|turnos)\b.{0,80}\b(movid|reprogramad|adelantad|cancelad|anulad)[ao]s?\b|\bcancelaci[oó]n\s+confirmada\b/i;

// Tools de citas existentes: con cualquiera de ellas en el turno, el texto habla
// de citas ya agendadas (consulta/cambio/cancelación), no de una reserva nueva —
// "tienes 4 citas agendadas" NO es una alucinación de prepare_reservation.
const EXISTING_APPOINTMENT_TOOLS = ["get_my_appointments", "reschedule_appointment", "cancel_appointment"];

// Razonamiento interno filtrado al cliente (casos reales de logs: "Las instrucciones
// dicen...", "el cliente acaba de decir...", "No puedo llamar prepare_reservation").
const REASONING_LEAK_PATTERN =
  /\[SISTEMA\]|\b(las|mis) instrucciones\b|\bel cliente (acaba|dijo|pide|quiere|contact)|\bpayload\b|\bstartDate\b/i;

// Cómo pedirle al modelo que reescriba sin que la corrección se filtre: la
// muletilla "Tienes razón..." de los logs era el modelo respondiéndole al aviso.
const NO_LEAK_SUFFIX =
  " Responde SOLO con el mensaje para el cliente: no menciones este aviso, ni herramientas, ni instrucciones, ni tu razonamiento, y no empieces con \"Tienes razón\" ni con disculpas.";

const SAFE_FALLBACK_REPLY = "¿Me cuentas de nuevo qué necesitas? Así te ayudo con tu reserva. 😊";

const SUMMARY_QUESTION = "¿Todo está correcto? ¿Confirmo tu reserva?";

// Respuestas que prometen una acción sin hacerla ("Un momento... 🔍" y el turno
// termina sin llamar ninguna tool — caso real 2026-10-23): se le pide al modelo
// que llame la herramienta en el mismo turno.
const PROMISED_ACTION_PATTERN =
  /\bun momento\b|\b(d[eé]jame|perm[ií]teme|voy a|ya te)\s+(revisar|buscar|consultar|verificar|confirmar|mirar|busco|reviso|consulto|confirmo)\b/i;

const depositLinkText = (checkout) =>
  `👉 Paga el abono de *${checkout.depositAmount}* aquí para confirmar tu reserva (tienes ${checkout.holdMinutes} minutos):\n${checkout.paymentUrl}`;

// Texto al cliente tras un confirm_reservation exitoso: con abono, la reserva
// queda apartada hasta que pague; sin abono, ya quedó agendada.
const confirmedReply = (confirmResult) =>
  confirmResult?.paymentUrl
    ? `✅ Tu reserva quedó apartada.\n\n${depositLinkText(confirmResult)}`
    : "✅ ¡Listo! Tu reserva quedó agendada. Te esperamos.";

// Nombre del servicio dentro de la línea "*Nombre* — 90 min — $45".
const serviceNameOf = (line) => (line.match(/^\*(.+?)\*/)?.[1] || "").toLowerCase();

// Antepone la línea de cada servicio consultado que ni esta respuesta ni un
// mensaje anterior del asistente ya mencionaron — el cliente que nombró un
// servicio ve su duración y precio antes de las preguntas de agenda.
function withServiceLines(reply, serviceLines, history) {
  if (!serviceLines.size || !reply) return reply;
  const lowerReply = reply.toLowerCase();
  const previous = history
    .filter((m) => m.role === "assistant" && typeof m.content === "string")
    .map((m) => m.content.toLowerCase())
    .join("\n");
  const missing = [...serviceLines].filter((line) => {
    const name = serviceNameOf(line);
    return name && !lowerReply.includes(name) && !previous.includes(name);
  });
  return missing.length ? `${missing.join("\n")}\n\n${reply}` : reply;
}

const extractText = (content) => {
  const block = content.find((b) => b.type === "text");
  return block?.text || "";
};

/**
 * Loop agéntico del asistente de reservas.
 *
 * @param {Object} organization
 * @param {Array}  messages  - historial [{ role, content }]
 * @param {Object} [options]
 * @param {string} [options.channel]     - "web" (default) | "whatsapp"
 * @param {Object} [options.session]     - sesión mutable (WhatsApp): pendingPayload, reservationCreated
 * @param {string} [options.sessionId]   - id de sesión (para chatSessionId en la reserva)
 * @param {string} [options.clientPhone] - teléfono del cliente (WhatsApp) para prellenar
 */
export const processBookingChat = async (organization, messages, options = {}) => {
  const channel = options.channel || "web";
  const isWhatsapp = channel === "whatsapp";

  const systemPrompt = buildBookingSystemPrompt(organization, {
    channel,
    clientPhone: options.clientPhone,
    // Estado entre turnos (WhatsApp): el historial visible es solo texto, así que
    // el prompt debe declarar explícitamente que hay una reserva preparada sin confirmar.
    pendingReservation: isWhatsapp ? options.session?.pendingPayload : null,
    // Señal persistente (no one-shot, a diferencia de session.reservationCreated):
    // ya se confirmó una reserva en algún turno anterior de esta misma conversación.
    hasConfirmedBooking: isWhatsapp && options.session?.hasConfirmedBookingThisSession === true,
    pendingDeposit: isWhatsapp ? options.session?.pendingDeposit : null,
  });
  const context = {
    organizationId: organization._id,
    organization,
    channel,
    session: options.session,
    sessionId: options.sessionId,
  };

  const baseTools = isWhatsapp ? bookingClaudeToolsWhatsapp : bookingClaudeTools;

  // Detecta si el texto dirigido al cliente filtró literalmente el nombre de una
  // tool (señal de razonamiento interno mezclado con la respuesta). Se construye
  // dinámicamente a partir de las tools registradas para no desactualizarse.
  const toolNameLeakPattern = new RegExp(
    `\\b(${baseTools.map((t) => t.name).join("|")})\\b`
  );

  let currentMessages = [...messages];
  let bookingPayload = null;
  const executedTools = new Set();
  // Tools que devolvieron success: true en este turno (para no aceptar "cita
  // movida/cancelada" cuando la tool se llamó pero falló).
  const successfulTools = new Set();
  const toolErrors = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let rounds = 0;
  // WhatsApp: resumen oficial devuelto por prepare_reservation en este turno, y
  // resultado de confirm_reservation cuando abrió el cobro del abono.
  let preparedSummary = null;
  let depositCheckout = null;
  // "*Servicio* — 90 min — $45" de los servicios consultados en este turno
  // (get_employees_for_service): si el modelo no le dijo al cliente qué servicio
  // y precio quedaron, se antepone (ver withServiceLines).
  const serviceLines = new Set();
  const lastUserText =
    [...messages].reverse().find((m) => m.role === "user" && typeof m.content === "string")?.content || "";

  const toolsWithCache = baseTools.map((t, i) =>
    i === baseTools.length - 1
      ? { ...t, cache_control: { type: "ephemeral" } }
      : t
  );

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    rounds = round + 1;
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Sonnet 5.5 rechaza { type: "disabled" } (400): between_tools es su nivel
      // mínimo — sin razonamiento extendido, solo notas cortas entre tools. Exige
      // effort high o menor y ningún otro campo dentro de thinking.
      thinking: { type: "between_tools" },
      output_config: { effort: "high" },
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      tools: toolsWithCache,
      messages: currentMessages,
    });

    inputTokens += response.usage?.input_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;

    // Filtros de seguridad de Sonnet 5.5: la respuesta llega sin texto. Se
    // contesta algo neutro en vez de reintentar (el guard de respuesta vacía lo
    // volvería a pedir y recibiría la misma negativa).
    if (response.stop_reason === "refusal") {
      console.warn(`[bookingChat] Respuesta rechazada por el modelo (${response.stop_details?.category || "sin categoría"})`);
      return {
        reply: SAFE_FALLBACK_REPLY,
        bookingPayload,
        _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: false, toolErrors },
      };
    }

    if (response.stop_reason !== "tool_use") {
      const rawReply = extractText(response.content);
      const meta = { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: false, toolErrors };

      // WhatsApp: si en este turno se preparó una reserva, el cliente recibe el
      // resumen armado por el servidor (nombres, fecha, precio y abono reales),
      // no el texto del modelo. Su "sí" llega en el próximo mensaje.
      if (isWhatsapp && preparedSummary && !successfulTools.has("confirm_reservation")) {
        options.session.pendingSummaryShown = true;
        return { reply: `${preparedSummary}\n\n${SUMMARY_QUESTION}`, bookingPayload, _meta: meta };
      }

      const reservationWasCreated =
        options.session?.reservationCreated === true || successfulTools.has("confirm_reservation");
      const pendingPayload = (isWhatsapp && options.session?.pendingPayload) || bookingPayload;
      const isLastRound = round === MAX_TOOL_ROUNDS - 1;

      // Las negaciones ("no pudo ser creada") son mensajes de error legítimos,
      // nunca deben tratarse como alucinación de éxito.
      const isNegatedReply = /\bno (pudo|fue|se pudo|logr|qued)/i.test(rawReply);
      const handledExistingAppointments = EXISTING_APPOINTMENT_TOOLS.some((t) => executedTools.has(t));
      // Si en este turno se consultaron/movieron/cancelaron citas existentes, el
      // texto describe esas citas — no es una reserva nueva anunciada sin tool.
      const looksLikeSuccess =
        !isNegatedReply && !handledExistingAppointments && BOOKING_HALLUCINATION_PATTERN.test(rawReply);
      const leaksInternals = rawReply !== "" && toolNameLeakPattern.test(rawReply);
      const leaksReasoning = rawReply !== "" && (leaksInternals || REASONING_LEAK_PATTERN.test(rawReply));
      const claimsExistingChange =
        !isNegatedReply &&
        EXISTING_APPOINTMENT_CLAIM_PATTERN.test(rawReply) &&
        !successfulTools.has("reschedule_appointment") &&
        !successfulTools.has("cancel_appointment");

      // Ambos canales: el bot afirma haber movido/cancelado una cita existente
      // sin que la tool correspondiente lo haya confirmado en este turno.
      if (claimsExistingChange) {
        if (!isLastRound) {
          currentMessages = [
            ...currentMessages,
            { role: "assistant", content: response.content },
            {
              role: "user",
              content:
                "[SISTEMA] Tu respuesta afirma que una cita existente fue movida o cancelada, pero en este turno ninguna herramienta lo confirmó. Si el cliente ya confirmó el cambio, llama reschedule_appointment o cancel_appointment AHORA (una llamada por cada cita) y responde según su resultado real. Si todavía no confirmó, reescribe tu respuesta sin afirmar el cambio." +
                NO_LEAK_SUFFIX,
            },
          ];
          continue;
        }
        return {
          reply: "No pude completar el cambio de tu cita todavía. ¿Me confirmas de nuevo qué cita quieres mover o cancelar y para cuándo?",
          bookingPayload,
          _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: false, toolErrors },
        };
      }

      // WhatsApp: el turno "debería" haber terminado en una reserva confirmada
      // pero no lo hizo — el modelo anunció éxito sin llamar confirm_reservation,
      // se quedó sin texto tras preparar la reserva (el bucle de "¿confirmo?"
      // repetido), o filtró razonamiento interno. En cualquiera de los 3 casos
      // NO se le devuelve ese texto al cliente.
      const whatsappNeedsResolution =
        isWhatsapp &&
        !reservationWasCreated &&
        (looksLikeSuccess || leaksInternals || (!rawReply && pendingPayload));

      if (whatsappNeedsResolution) {
        if (!isLastRound) {
          currentMessages = [
            ...currentMessages,
            { role: "assistant", content: response.content },
            {
              role: "user",
              content: pendingPayload
                ? "[SISTEMA] La reserva AÚN NO fue creada. Si el cliente acaba de confirmar el resumen, llama confirm_reservation AHORA y responde según su resultado real. Si no lo confirmó, reescribe tu respuesta sin decir que la reserva quedó hecha." +
                  NO_LEAK_SUFFIX
                : leaksInternals && !looksLikeSuccess
                ? "[SISTEMA] Tu respuesta incluía detalles internos que el cliente no debe ver. Reescríbela dirigida al cliente, breve y natural." +
                  NO_LEAK_SUFFIX
                : "[SISTEMA] Tu respuesta da a entender que una reserva nueva ya quedó hecha, pero no hay ninguna reserva preparada. Si el cliente completó todos los datos y confirmó el resumen, llama prepare_reservation (y luego confirm_reservation). Si faltan datos o el mensaje no trata de una reserva nueva, reescribe tu respuesta sin afirmar que la reserva quedó hecha." +
                  NO_LEAK_SUFFIX,
            },
          ];
          continue;
        }

        // Última ronda disponible: no hay más turnos para que el modelo
        // reintente. Si ya hay una reserva preparada y el cliente acaba de
        // decir que sí, la confirmamos nosotros mismos y respondemos según el
        // resultado REAL — nunca según el texto (potencialmente alucinado) que
        // generó el modelo. Sin un "sí" explícito nunca se confirma.
        if (pendingPayload && isExplicitConfirmation(lastUserText)) {
          let confirmResult;
          try {
            confirmResult = await executeBookingTool("confirm_reservation", {}, context);
          } catch (err) {
            confirmResult = { success: false, error: err.message };
          }
          executedTools.add("confirm_reservation");
          return {
            reply: confirmResult?.success
              ? confirmedReply(confirmResult)
              : "Tuve un problema confirmando tu reserva. ¿La confirmas de nuevo, por favor?",
            bookingPayload,
            _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: false, toolErrors },
          };
        }
        return {
          reply: "Necesito confirmar un par de datos más antes de agendar — ¿me cuentas de nuevo qué servicio y horario prefieres?",
          bookingPayload,
          _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: false, toolErrors },
        };
      }

      // Guard web de fuga de razonamiento: nombres de tools, "las instrucciones
      // dicen...", el cliente en tercera persona. Antes solo existía en WhatsApp —
      // en la web esos textos llegaban tal cual al cliente (7 sesiones en
      // sep-2026). Se pide reescribir; en la última ronda se usa un texto seguro.
      if (!isWhatsapp && leaksReasoning) {
        if (!isLastRound) {
          currentMessages = [
            ...currentMessages,
            { role: "assistant", content: response.content },
            {
              role: "user",
              content:
                "[SISTEMA] Tu respuesta incluía detalles internos que el cliente no debe ver. Reescríbela dirigida al cliente, breve y natural, respondiendo a su último mensaje." +
                NO_LEAK_SUFFIX,
            },
          ];
          continue;
        }
        return {
          reply: bookingPayload !== null
            ? "¡Listo! Toca el botón **'Sí, confirmar'** para finalizar tu reserva."
            : SAFE_FALLBACK_REPLY,
          bookingPayload,
          _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: false, toolErrors },
        };
      }

      // Guard web: el bot dice que la reserva fue confirmada sin haber llamado
      // prepare_reservation. La corrección es neutra a propósito: antes ordenaba
      // "llama prepare_reservation AHORA" y, cuando el falso positivo venía de
      // otro tema (ej. "tienes 4 citas agendadas"), el modelo respondía con su
      // razonamiento ("Tienes razón... no puedo llamar prepare_reservation").
      if (!isWhatsapp && bookingPayload === null && looksLikeSuccess) {
        if (!isLastRound) {
          currentMessages = [
            ...currentMessages,
            { role: "assistant", content: response.content },
            {
              role: "user",
              content:
                "[SISTEMA] Tu respuesta da a entender que una reserva nueva ya quedó hecha, pero no hay ninguna reserva preparada. Si el cliente completó todos los datos y confirmó el resumen, llama prepare_reservation. Si faltan datos o el mensaje no trata de una reserva nueva, reescribe tu respuesta sin afirmar que la reserva quedó hecha." +
                NO_LEAK_SUFFIX,
            },
          ];
          continue;
        }
        return {
          reply: "¡Ya casi! Confírmame el servicio, la fecha y la hora para prepararte el resumen de tu reserva.",
          bookingPayload,
          _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: false, toolErrors },
        };
      }

      // Fallback: si prepare_reservation ya fue llamada pero el reply quedó vacío
      // (el modelo generó el mensaje del botón en la misma ronda que la tool call) —
      // solo aplica al canal web; en WhatsApp ese caso ya lo resuelve el bloque de
      // arriba (whatsappNeedsResolution).
      let reply =
        rawReply ||
        (bookingPayload !== null && !isWhatsapp
          ? "¡Listo! Toca el botón **'Sí, confirmar'** para finalizar tu reserva."
          : "");

      // El modelo a veces cierra el turno después de una tool sin escribir nada
      // (caso visto 1 de cada 3 con "¿hay cita mañana a las 10:30?"). Se le pide
      // la respuesta; en la última ronda se usa un texto seguro.
      if (!reply && !depositCheckout) {
        if (!isLastRound) {
          const nudge = {
            type: "text",
            text: "[SISTEMA] No escribiste ningún mensaje para el cliente. Responde ahora a su último mensaje, breve." + NO_LEAK_SUFFIX,
          };
          const last = currentMessages[currentMessages.length - 1];
          // El turno anterior es del usuario (resultado de tools o su mensaje):
          // se le agrega el aviso en vez de insertar un turno de asistente vacío.
          currentMessages = [
            ...currentMessages.slice(0, -1),
            {
              ...last,
              content: Array.isArray(last.content)
                ? [...last.content, nudge]
                : [{ type: "text", text: String(last.content) }, nudge],
            },
          ];
          continue;
        }
        reply = SAFE_FALLBACK_REPLY;
      }

      // Promete buscar/revisar y termina el turno sin hacerlo: el cliente se
      // queda esperando algo que nunca llega.
      if (!isLastRound && !depositCheckout && PROMISED_ACTION_PATTERN.test(reply)) {
        currentMessages = [
          ...currentMessages,
          { role: "assistant", content: response.content },
          {
            role: "user",
            content:
              "[SISTEMA] Tu respuesta promete revisar o buscar algo pero no lo hiciste. Llama ahora la herramienta que necesitas y responde con el resultado; si no necesitas ninguna, reescribe el mensaje sin prometer una acción futura." +
              NO_LEAK_SUFFIX,
          },
        ];
        continue;
      }

      // El enlace de pago del abono tiene que llegar sí o sí: el modelo puede
      // resumirlo, recortarlo u olvidarlo.
      if (depositCheckout && !reply.includes(depositCheckout.paymentUrl)) {
        reply = reply ? `${reply}\n\n${depositLinkText(depositCheckout)}` : confirmedReply(depositCheckout);
      }

      // Canal WhatsApp: el modelo puede optar por no responder (mensaje sin
      // intención de agendar) o por pasarle el mensaje a una persona del
      // negocio — ver FILTRO DE INTENCIÓN en el prompt.
      const noReply = isWhatsapp && reply.trim() === NO_REPLY_SENTINEL;
      const handoff = isWhatsapp && reply.includes(HANDOFF_SENTINEL);
      if (!noReply && !handoff && !depositCheckout) {
        reply = withServiceLines(reply, serviceLines, messages);
      }

      return {
        reply: noReply || handoff ? "" : reply,
        bookingPayload,
        noReply,
        handoff,
        _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: false, toolErrors },
      };
    }

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        executedTools.add(block.name);
        let result;
        try {
          result = await executeBookingTool(block.name, block.input, context);
          if (result?.success) successfulTools.add(block.name);
          if (block.name === "prepare_reservation") {
            if (result?.success) bookingPayload = result.payload;
            preparedSummary = result?.success ? result.summaryText || null : null;
          }
          if (block.name === "confirm_reservation" && result?.success && result.paymentUrl) {
            depositCheckout = result;
          }
          if (block.name === "get_employees_for_service" && result?.serviceLine) {
            serviceLines.add(result.serviceLine);
          }
        } catch (err) {
          result = { success: false, error: err.message };
        }
        if (result?.success === false && result?.error) {
          toolErrors.push({ tool: block.name, error: String(result.error).slice(0, 300) });
        }
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        };
      })
    );

    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: response.content },
      { role: "user", content: toolResults },
    ];
  }

  // Se agotaron las rondas sin llegar a una respuesta de texto (todas fueron
  // tool_use). Si la última tool ejecutada sí confirmó la reserva, no le digamos
  // al cliente que fracasó — eso generaría el mensaje contradictorio inverso.
  if (isWhatsapp && preparedSummary && !successfulTools.has("confirm_reservation")) {
    options.session.pendingSummaryShown = true;
    return {
      reply: `${preparedSummary}\n\n${SUMMARY_QUESTION}`,
      bookingPayload,
      _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: true, toolErrors },
    };
  }
  const reservationWasCreated = options.session?.reservationCreated === true;
  return {
    reply:
      isWhatsapp && (reservationWasCreated || depositCheckout)
        ? confirmedReply(depositCheckout)
        : "Lo siento, no pude completar el proceso. Por favor intenta de nuevo.",
    bookingPayload,
    _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: true, toolErrors },
  };
};
