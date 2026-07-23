import Anthropic from "@anthropic-ai/sdk";
import { buildBookingSystemPrompt, NO_REPLY_SENTINEL } from "./bookingSystemPrompt.js";
import {
  bookingClaudeTools,
  bookingClaudeToolsWhatsapp,
  executeBookingTool,
} from "./bookingToolRegistry.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;
const MAX_TOOL_ROUNDS = 8;

// Detecta cuando el bot afirma que la reserva fue confirmada/procesada sin haber
// llamado prepare_reservation. Cubre "reserva confirmada", tiempo pasado del verbo
// ("reservé", "agendé") y el mensaje del botón que solo debe decirse DESPUÉS de la tool.
const BOOKING_HALLUCINATION_PATTERN =
  /\b(reserva|turno|cita)\b.{0,150}\b(confirmad[ao]|procesad[ao]|cread[ao]|agendad[ao]|registrad[ao]|complet[ao]|exitosa|realizada)\b|\bbotón\b.{0,80}\b(confirmar|verificar)\b|haz clic.{0,60}(confirmar|s[ií])|\b(reservé|agendé|confirmé)\b/i;

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
  let inputTokens = 0;
  let outputTokens = 0;
  let rounds = 0;

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
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      tools: toolsWithCache,
      messages: currentMessages,
    });

    inputTokens += response.usage?.input_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;

    if (response.stop_reason !== "tool_use") {
      const rawReply = extractText(response.content);
      const reservationWasCreated = options.session?.reservationCreated === true;
      const pendingPayload = (isWhatsapp && options.session?.pendingPayload) || bookingPayload;
      const isLastRound = round === MAX_TOOL_ROUNDS - 1;

      // Las negaciones ("no pudo ser creada") son mensajes de error legítimos,
      // nunca deben tratarse como alucinación de éxito.
      const isNegatedReply = /\bno (pudo|fue|se pudo|logr|qued)/i.test(rawReply);
      const looksLikeSuccess = !isNegatedReply && BOOKING_HALLUCINATION_PATTERN.test(rawReply);
      const leaksInternals = rawReply !== "" && toolNameLeakPattern.test(rawReply);

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
                ? "[SISTEMA] La reserva AÚN NO fue creada. Llama confirm_reservation AHORA para crearla de verdad antes de anunciarla al cliente. Responde solo con el resultado dirigido al cliente, sin explicar tu razonamiento ni mencionar nombres de herramientas."
                : "[SISTEMA] Aún no llamaste prepare_reservation. Debes llamarla AHORA con todos los datos recopilados (y luego confirm_reservation) antes de dar esa respuesta al cliente.",
            },
          ];
          continue;
        }

        // Última ronda disponible: no hay más turnos para que el modelo
        // reintente. Si ya hay una reserva preparada, la confirmamos nosotros
        // mismos y respondemos según el resultado REAL — nunca según el texto
        // (potencialmente alucinado) que generó el modelo.
        if (pendingPayload) {
          let confirmResult;
          try {
            confirmResult = await executeBookingTool("confirm_reservation", {}, context);
          } catch (err) {
            confirmResult = { success: false, error: err.message };
          }
          executedTools.add("confirm_reservation");
          return {
            reply: confirmResult?.success
              ? "✅ ¡Listo! Tu reserva quedó agendada. Te esperamos."
              : "Tuve un problema confirmando tu reserva. ¿La confirmas de nuevo, por favor?",
            bookingPayload,
            _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: false },
          };
        }
        return {
          reply: "Necesito confirmar un par de datos más antes de agendar — ¿me cuentas de nuevo qué servicio y horario prefieres?",
          bookingPayload,
          _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: false },
        };
      }

      // Guard web: el bot dice que la reserva fue confirmada sin haber llamado
      // prepare_reservation. Inyecta una corrección y continúa el loop.
      if (!isWhatsapp && bookingPayload === null && looksLikeSuccess) {
        if (!isLastRound) {
          currentMessages = [
            ...currentMessages,
            { role: "assistant", content: response.content },
            {
              role: "user",
              content:
                "[SISTEMA] Aún no llamaste prepare_reservation. Debes llamarla AHORA con todos los datos recopilados antes de dar esa respuesta al cliente.",
            },
          ];
          continue;
        }
        return {
          reply: "¡Ya casi! Confírmame el servicio, la fecha y la hora para prepararte el resumen de tu reserva.",
          bookingPayload,
          _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: false },
        };
      }

      // Fallback: si prepare_reservation ya fue llamada pero el reply quedó vacío
      // (el modelo generó el mensaje del botón en la misma ronda que la tool call) —
      // solo aplica al canal web; en WhatsApp ese caso ya lo resuelve el bloque de
      // arriba (whatsappNeedsResolution).
      const reply =
        rawReply ||
        (bookingPayload !== null && !isWhatsapp
          ? "¡Listo! Toca el botón **'Sí, confirmar'** para finalizar tu reserva."
          : "");

      // Canal WhatsApp: el modelo puede optar por no responder (mensaje sin
      // intención de agendar — ver FILTRO DE INTENCIÓN en el prompt).
      const noReply = isWhatsapp && reply.trim() === NO_REPLY_SENTINEL;

      return {
        reply: noReply ? "" : reply,
        bookingPayload,
        noReply,
        _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: false },
      };
    }

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        executedTools.add(block.name);
        let result;
        try {
          result = await executeBookingTool(block.name, block.input, context);
          if (block.name === "prepare_reservation" && result?.success) {
            bookingPayload = result.payload;
          }
        } catch (err) {
          result = { success: false, error: err.message };
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
  const reservationWasCreated = options.session?.reservationCreated === true;
  return {
    reply:
      isWhatsapp && reservationWasCreated
        ? "✅ ¡Listo! Tu reserva quedó agendada. Te esperamos."
        : "Lo siento, no pude completar el proceso. Por favor intenta de nuevo.",
    bookingPayload,
    _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: true },
  };
};
