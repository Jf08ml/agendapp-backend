import Anthropic from "@anthropic-ai/sdk";
import moment from "moment-timezone";
import { buildSystemPrompt } from "./systemPrompt.js";
import { claudeTools, executeTool } from "./toolRegistry.js";
import Service from "../models/serviceModel.js";
import Employee from "../models/employeeModel.js";
import Organization from "../models/organizationModel.js";
import { markOnboardingMilestone } from "../utils/onboardingMilestones.js";
import { describeAdminToolAction, actionLogPrompt } from "../booking-chatbot/actionLog.js";
import { withMessageCacheBreakpoint } from "../utils/claudeCache.js";
import { getServiceSuggestions, LARGE_DENOMINATION_CURRENCIES } from "../utils/verticalCatalogs.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Bajado de Sonnet 5 a Haiku 4.5 el 2026-08-26 por costo (mitad de precio en
// ambos lados). Sonnet se había subido en agosto por alucinaciones reales de
// Haiku (ver CLAUDE.md / memoria "fase2-ronda2-guardrails-y-upgrade-modelo")
// — los guards anti-alucinación siguen activos, pero Haiku los ignoraba más
// seguido. Decisión consciente del usuario, revisar chatlogs si reaparecen.
const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 4096;
const MAX_TOOL_ROUNDS = 8;

const buildContext = async (organization, user) => {
  const [servicesCount, employeesCount] = await Promise.all([
    Service.countDocuments({ organizationId: organization._id, isActive: true }),
    Employee.countDocuments({ organizationId: organization._id, isActive: true }),
  ]);

  const setupCompleted = organization.setupCompleted || false;
  return {
    organizationId: organization._id,
    organization,
    user,
    currentDate: moment.tz(organization.timezone || "America/Bogota").format("YYYY-MM-DD"),
    setupStatus: {
      servicesCount,
      employeesCount,
      setupCompleted,
      // Mismo criterio que buildOnboardingWidgets: el usuario ve la lista de
      // servicios sugeridos debajo de la respuesta, y el prompt lo menciona.
      servicePickerShown:
        !setupCompleted &&
        servicesCount === 0 &&
        getServiceSuggestions(organization.businessVertical, organization.currency).length > 0,
    },
  };
};

/**
 * Tarjetas interactivas que el chat muestra debajo de la respuesta durante el
 * onboarding. Las decide el servidor según el estado REAL de la org después del
 * turno (no el texto del modelo), así no dependen de que el modelo "se acuerde".
 *  - service_picker: onboarding sin servicios activos y rubro con sugerencias →
 *    lista para marcar servicios y ponerles precio (el frontend la envía como
 *    mensaje y el modelo los crea con bulk_create_services).
 */
export const buildOnboardingWidgets = async (organizationId) => {
  const org = await Organization.findById(organizationId)
    .select("setupCompleted businessVertical currency")
    .lean();
  if (!org || org.setupCompleted) return [];
  const suggestions = getServiceSuggestions(org.businessVertical, org.currency);
  if (!suggestions.length) return [];
  const servicesCount = await Service.countDocuments({ organizationId, isActive: true });
  if (servicesCount > 0) return [];
  return [{ type: "service_picker", currency: org.currency || "COP", suggestions }];
};

const extractText = (content) => {
  const block = content.find((b) => b.type === "text");
  return block?.text || "";
};

// Tools que modifican la org → el frontend debe refrescar el store de organización
const ORG_INVALIDATING_TOOLS = new Set([
  "update_booking_config",
  "update_schedule",
  "update_primary_color",
  "mark_setup_complete",
]);

// Tools de creación/asignación cuyo éxito el modelo podría afirmar sin haberlas
// llamado realmente (o ignorando que el resultado real fue un error/duplicado).
const MUTATION_TOOLS = new Set([
  "create_service",
  "bulk_create_services",
  "create_employee",
  "assign_services_to_employee",
]);

// Detecta cuando la respuesta afirma que se creó/agregó/asignó/registró un
// servicio o profesional (en cualquier orden de palabras y cualquier conjugación).
const ACTION_STEM = "(cre\\w*|agreg\\w*|asign\\w*|registr\\w*)";
const ENTITY_NOUN = "(servicio|profesional|empleado)s?";
// [\s\S] y no "." para cruzar saltos de línea: "✅ **X creado**\n\n…8 servicios" no
// matcheaba con "." (Studio nails Heidy, 2026-11-06).
const CRUD_CLAIM_PATTERN = new RegExp(
  `\\b${ENTITY_NOUN}\\b[\\s\\S]{0,120}\\b${ACTION_STEM}\\b|\\b${ACTION_STEM}\\b[\\s\\S]{0,120}\\b${ENTITY_NOUN}\\b`,
  "i"
);

// Detecta si el ÚLTIMO mensaje de texto del usuario pidió crear/agregar/asignar
// algo — para no disparar el guard cuando el usuario solo está preguntando por
// algo ya creado en un turno anterior (ej: "¿ya quedó el servicio?").
const CREATION_INTENT_PATTERN =
  /\b(crea|crear|creame|créame|cream[eo]s|agrega|agregar|agrégame|añad[ei]|asigna|asignar|asígnale|asígname|registra|registrar|dame de alta|da de alta|suma|sumar)\b/i;

// "Sí" / "dale" / "listo" respondiendo a "¿lo creo?" también es pedir la acción —
// caso real (Studio nails Heidy, 2026-11-06): "¿Quieres que cree Retoque soft gel
// igual?" → "Si" → "✅ Retoque soft gel creado" sin ninguna tool; el servicio no existe.
const AFFIRMATIVE_REPLY_PATTERN =
  /^\s*(s[ií]|sip|dale|ok(ay)?|listo|claro|confirmo|confirmado|correcto|perfecto|de una|h[aá]zlo|adelante|por favor|exacto)(?![\wáéíóúñ])/i;
const asksForAction = (text) => CREATION_INTENT_PATTERN.test(text) || AFFIRMATIVE_REPLY_PATTERN.test(text);

// "✅ Horario configurado" sin update_schedule — caso real (Studio nails Heidy,
// 2026-11-06): el usuario dio "lunes a sábado de 8 a 5" y "30", el bot lo dio por
// guardado y el negocio quedó con el horario genérico. Solo cuando el último
// mensaje del usuario aporta datos de horario o confirma (no cuando pregunta
// "¿cuál es mi horario?", donde describirlo es legítimo).
const SCHEDULE_TOOLS = new Set(["update_schedule", "block_employee_time", "unblock_employee_time"]);
const SCHEDULE_CLAIM_PATTERN =
  /\bhorarios?\b.{0,60}\b(configurad|guardad|actualizad|establecid|cambiad|bloquead)[ao]s?\b|\b(configur[eé]|guard[eé]|actualic[eé]|cambi[eé]|bloque[eé])(?![\wáéíóúñ]).{0,40}\bhorarios?\b/i;
const SCHEDULE_INTENT_PATTERN =
  /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?|horarios?|am|pm|ma[ñn]ana|tarde|noche|cerrado)\b|\d/i;
// Bloqueos de agenda afirmados sin tool — casos reales (Diana Vargas): 27-oct
// "✅ Bloqueado correctamente" ×2 sin llamar nada; 5-nov "sábado 14 bloqueado" sin
// tool y luego "el bloqueo está registrado (acabo de ejecutarlo)"; 9-nov "ya tiene
// disponibles el 13 y 14 — se quitó la marca roja" tras AGREGAR bloqueos. Cualquier
// afirmación sobre el estado de un bloqueo exige haber bloqueado, desbloqueado o
// consultado con éxito en este turno.
const BLOCK_TOOLS = new Set(["block_employee_time", "unblock_employee_time", "get_employee_blocks"]);
const BLOCK_CLAIM_PATTERN =
  /\b(bloquead[oa]s?|desbloquead[oa]s?)\b|\b(se\s+)?quit[oóeé](?![\wáéíóúñ]).{0,40}\b(bloqueos?|marcas?|franjas?)\b|\bya\s+(tiene|est[aá]n?)\s+disponibles?\b|\b(acabo de|ya lo)\s+(ejecut|registr|bloque|quit)/i;

const isScheduleInput = (text) =>
  !/[¿?]/.test(text) && (SCHEDULE_INTENT_PATTERN.test(text) || AFFIRMATIVE_REPLY_PATTERN.test(text));

// Claims de acciones DESTRUCTIVAS (eliminar/borrar/cancelar servicio o cita) sin
// haber llamado la tool correspondiente — caso real observado en logs: el bot
// confirmó "citas eliminadas" sin haber llamado cancel_or_delete_appointment.
const DESTRUCTIVE_TOOLS = new Set(["delete_service", "cancel_or_delete_appointment"]);
const DESTRUCTIVE_ACTION_STEM = "(elimin\\w*|borr\\w*|cancel\\w*)";
const DESTRUCTIVE_ENTITY_NOUN = "(servicio|cita)s?";
const DESTRUCTIVE_CLAIM_PATTERN = new RegExp(
  `\\b${DESTRUCTIVE_ENTITY_NOUN}\\b.{0,120}\\b${DESTRUCTIVE_ACTION_STEM}\\b|\\b${DESTRUCTIVE_ACTION_STEM}\\b.{0,120}\\b${DESTRUCTIVE_ENTITY_NOUN}\\b`,
  "i"
);
const DESTRUCTIVE_INTENT_PATTERN = /\b(elimina|eliminar|borra|borrar|cancela|cancelar|quita|quitar)\b/i;

// "✓ Le envié el mensaje de confirmación a Erika" — caso real (MIMOS PARA TI,
// 2026-10-02): no existe ninguna tool para enviar mensajes sueltos. Solo las tools
// de citas envían WhatsApp como efecto secundario (crear/cancelar con aviso/reprogramar).
const MESSAGE_SENDING_TOOLS = new Set(["create_appointments", "cancel_or_delete_appointment", "reschedule_appointment"]);
const MESSAGE_SENT_CLAIM_PATTERN =
  /\b(le\s+|les\s+)?(envi[eé]|reenvi[eé]|mand[eé]|he\s+enviado|he\s+reenviado|ya\s+(se\s+)?(envi[oó]|mand[oó]))(?![\wáéíóúñ]).{0,80}\b(mensaje|confirmaci[oó]n|recordatorio|whats\s?app|notificaci[oó]n)/i;

// Clientes "registrados/actualizados" sin tool — caso real (María C Lashes,
// 2026-09-10): "¡Todos registrados! He guardado estos 72 clientes" en una sola
// respuesta, y "Voy a actualizar esa información en el sistema" (Camilash) sin
// ninguna tool de edición.
// find_clients / get_inactive_clients incluidas: tras consultarlas, "la clienta ya
// está registrada" es una respuesta informativa legítima, no un claim de escritura.
const CLIENT_TOOLS = new Set(["create_client", "update_client", "create_appointments", "find_clients", "get_inactive_clients"]);
const CLIENT_CLAIM_PATTERN =
  /\b(client[ae]s?)\b.{0,120}\b(registrad|cread|guardad|actualizad|agregad)[ao]s?\b|\b(registr[eé]|guard[eé]|actualic[eé]|he\s+(registrado|guardado|actualizado))(?![\wáéíóúñ]).{0,80}\b(client[ae]s?|datos|tel[eé]fono|correo)\b|\bvoy a actualizar\b.{0,60}\ben el sistema\b/i;

// Claims de configuración afirmados en pasado sin haber llamado la tool:
// "✅ Aprobación automática configurada", "la política de reserva quedó..." —
// caso real observado en logs de onboarding (la org quedó en manual creyendo
// que era automática). El patrón es estrecho a propósito: la pregunta del PASO 4
// ("¿quieres aprobarla manualmente o que se confirme automáticamente?") no matchea.
const POLICY_CLAIM_PATTERN =
  /\b(aprobaci[oó]n|pol[ií]tica)\b.{0,60}\b(configurad|activad|establecid|guardad|qued[oó]|list[ao]\b)|\breservas?\s+(en\s+l[ií]nea\s+)?(autom[aá]ticas?|manuales?)\b.{0,30}\b(configurad|activad)|\b(configur[eé]|activ[eé]|dej[eé])(?![\wáéíóúñ]).{0,40}\b(aprobaci[oó]n|reservas?)\b/i;

// El usuario está eligiendo la política en su último mensaje ("automática",
// "manual", "1"/"2" tras la pregunta del PASO 4). Necesario porque
// autoCompleteSetupIfReady marca setupCompleted apenas hay servicio+profesional+
// horario — ANTES del paso de política — y desde ese turno el guard (que solo
// corría en onboarding) dejaba de aplicar. Casos reales sep-2026: 6 negocios
// eligieron "automática", el bot dijo "✅ Reservas automáticas configuradas" y
// quedaron en manual (Aruna, chiqui, NyE, Stilos wilrey, AP Peritaciones, María C Lashes).
const POLICY_INTENT_PATTERN = /\b(autom[aá]tic[ao]s?|manual(es|mente)?|aprobar(las)?|aprobaci[oó]n)\b|^\s*[12]\s*\.?\s*$/i;

// "✅ Color morado pastel (#D4A5D4) configurado" sin update_primary_color — caso
// real (Judith 2026-09-02: quedó #00888f; Stilos wilrey, AP Peritaciones).
const COLOR_INTENT_PATTERN =
  /\bcolor|\b(azul|rojo|verde|rosa(do)?|morado|lila|violeta|negro|blanco|amarillo|dorado|plateado|celeste|naranja|gris|turquesa|beige|vinotinto|fucsia|caf[eé]|marr[oó]n|menta|pastel)\b|#[0-9a-f]{3,6}\b/i;
const COLOR_CLAIM_PATTERN =
  /\bcolor\b.{0,80}\b(configurad|activad|actualizad|aplicad|guardad|cambiad)[ao]\b|\b(apliqu[eé]|configur[eé]|cambi[eé]|actualic[eé])(?![\wáéíóúñ]).{0,40}\bcolor\b/i;

// "¡Configuración inicial completada!" / "tu negocio ya está configurado" sin
// mark_setup_complete — deja al usuario atrapado rebotando al wizard.
const SETUP_DONE_CLAIM_PATTERN =
  /\bconfiguraci[oó]n\b.{0,60}\b(complet|finaliz|list[ao]\b)|\b(ya\s+est[aá]|qued[oó])\s+configurad/i;

const findLastUserText = (messages) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
};

// Cierre determinista del onboarding: si los criterios reales ya se cumplen
// (≥1 servicio, ≥1 profesional, horario habilitado), marca setupCompleted +
// milestone del funnel SIN depender de que el modelo llame mark_setup_complete
// (en producción el modelo lo olvida con frecuencia y la org queda atrapada
// rebotando al wizard). Se consulta estado FRESCO — las tools de este turno
// pudieron haber creado servicios/horario después de construirse el context.
// Devuelve true si completó el setup en esta llamada.
const autoCompleteSetupIfReady = async (organizationId) => {
  try {
    const [servicesCount, employeesCount, org] = await Promise.all([
      Service.countDocuments({ organizationId, isActive: true }),
      Employee.countDocuments({ organizationId, isActive: true }),
      Organization.findById(organizationId).select("setupCompleted weeklySchedule").lean(),
    ]);
    if (!org || org.setupCompleted) return false;
    const hasSchedule = !!(org.weeklySchedule?.enabled && org.weeklySchedule?.schedule?.length);
    if (servicesCount === 0 || employeesCount === 0 || !hasSchedule) return false;

    await Organization.updateOne({ _id: organizationId }, { $set: { setupCompleted: true } });
    await markOnboardingMilestone(organizationId, "setupCompletedAt");
    console.log(`[chatService] Setup autocompletado server-side — org=${organizationId}`);
    return true;
  } catch (err) {
    // Nunca romper el chat por la instrumentación
    console.error("[chatService] autoCompleteSetupIfReady:", err?.message || err);
    return false;
  }
};

// Mensaje que envía el frontend al abrir el onboarding con IA (useChatbot.ts,
// ONBOARDING_TRIGGER). Si cambia allá, cambiarlo aquí.
export const ONBOARDING_TRIGGER = "Hola, quiero comenzar la configuración inicial de mi negocio.";

/**
 * Primer mensaje del onboarding cuando no hay NADA creado: fijo, sin modelo.
 * Antes lo escribía el modelo (~600 caracteres con los 8 pasos) y 23 de 34 orgs
 * que abandonaban sin crear nada se iban justo después de leerlo; con el prompt
 * más corto el modelo seguía ignorando la lista de sugerencias 1 de cada 3 veces.
 * Con progreso parcial (reanudar) sí responde el modelo.
 */
const onboardingOpening = (context) => {
  const { organization, setupStatus } = context;
  const name = organization?.name?.trim() || "tu negocio";
  const intro = `¡Hola! 👋 En unos minutos dejamos lista la agenda de **${name}**.`;
  if (setupStatus.servicePickerShown) {
    return `${intro}\n\nEmpecemos por tus servicios: **marca abajo los que ofreces y ponles tu precio** 👇\n\nSi ofreces otros, agrégalos en la misma lista o escríbemelos aquí.`;
  }
  const mult = LARGE_DENOMINATION_CURRENCIES.has(String(organization?.currency || "").toUpperCase()) ? 1000 : 1;
  return `${intro}\n\nEmpecemos por tus servicios: escríbeme los que ofreces con su duración y precio, por ejemplo: *Corte 30 min $${(25 * mult).toLocaleString("es-CO")}*. Puedes pegarlos todos de una vez.`;
};

export const processChat = async (organization, user, messages, { actionLog = [] } = {}) => {
  const context = await buildContext(organization, user);

  const userTurns = messages.filter((m) => m.role === "user");
  if (
    !context.setupStatus.setupCompleted &&
    context.setupStatus.servicesCount === 0 &&
    context.setupStatus.employeesCount === 0 &&
    userTurns.length === 1 &&
    String(userTurns[0].content).trim() === ONBOARDING_TRIGGER
  ) {
    return {
      reply: onboardingOpening(context),
      invalidates: [],
      _meta: {
        rounds: 0, toolsUsed: [], inputTokens: 0, outputTokens: 0,
        cacheReadTokens: 0, cacheWriteTokens: 0, hitRoundLimit: false, toolErrors: [], actions: [],
      },
    };
  }

  const systemPrompt = buildSystemPrompt(context);
  // Acciones de turnos anteriores (el historial es solo texto): bloque aparte,
  // fuera de la caché del prompt — ver booking-chatbot/actionLog.js.
  const actionLogText = actionLogPrompt(actionLog);
  const system = [
    { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
    ...(actionLogText ? [{ type: "text", text: actionLogText }] : []),
  ];

  let currentMessages = [...messages];
  const executedTools = new Set();
  // Tools que terminaron sin success:false — para guards donde una llamada fallida
  // no cuenta (ej. block_employee_time rechazado por intentar "desbloquear").
  const successfulTools = new Set();
  const toolErrors = [];
  const actions = [];
  let inputTokens = 0;
  let outputTokens = 0;
  // input_tokens excluye la caché: sin estos dos el costo real no se puede calcular
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let rounds = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    rounds = round + 1;
    const toolsWithCache = claudeTools.map((t, i) =>
      i === claudeTools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t
    );

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Haiku 4.5 no piensa por defecto sin budget_tokens — este disabled explícito
      // es un remanente inofensivo de cuando el modelo era Sonnet 5 (adaptativo por
      // defecto); se deja igual para no tocar el request shape entre modelos.
      thinking: { type: "disabled" },
      system,
      tools: toolsWithCache,
      messages: withMessageCacheBreakpoint(currentMessages),
    });

    inputTokens += response.usage?.input_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;
    cacheReadTokens += response.usage?.cache_read_input_tokens ?? 0;
    cacheWriteTokens += response.usage?.cache_creation_input_tokens ?? 0;

    if (response.stop_reason !== "tool_use") {
      // Fallback: si el modelo terminó el turno sin bloque de texto (puede pasar en
      // sesiones largas con muchas tool calls seguidas), nunca devolver un reply vacío.
      // CRÍTICO: este texto NO debe afirmar que algo se completó — cuando este fallback
      // se dispara es precisamente porque no sabemos qué pasó, y los guards de abajo no
      // detectan un claim de éxito genérico sin el nombre de la entidad (caso real:
      // Rossette Spa, "Listo, ya quedó registrado" sin haber creado ningún servicio).
      const reply =
        extractText(response.content) ||
        "¿Puedes confirmarme de nuevo qué necesitas? No terminé de procesar tu mensaje anterior.";

      // Guards anti-alucinación: el bot afirma haber hecho algo sin haber llamado
      // la herramienta correspondiente. Se inyecta una corrección [SISTEMA] y se
      // repite la ronda para que ejecute la tool de verdad.
      let correction = null;

      // 1) Claims de creación/asignación (servicio/profesional) sin tool de mutación,
      //    Y el usuario sí pidió esa acción en su último mensaje (para no disparar
      //    esto cuando solo pregunta por algo creado en un turno anterior).
      const calledMutationTool = [...executedTools].some((t) => MUTATION_TOOLS.has(t));
      if (
        !calledMutationTool &&
        CRUD_CLAIM_PATTERN.test(reply) &&
        asksForAction(findLastUserText(currentMessages))
      ) {
        correction =
          "[SISTEMA] No llamaste ninguna herramienta de creación/asignación (create_service, bulk_create_services, create_employee o assign_services_to_employee) todavía. Si ya tienes los datos, llámala AHORA antes de confirmar. Si te faltan datos del usuario, pídelos de forma breve y natural — sin disculparte, sin mencionar herramientas, errores internos ni este mensaje. Si la herramienta devuelve success: false, duplicateWarning, priceWarning o items en 'failed', informa ese resultado real — no digas que se creó/asignó si no fue así.";
      }
      // 1b) Claims de eliminación/cancelación (servicio/cita) sin tool de borrado —
      //     caso real de logs: el bot confirmó "citas eliminadas" sin llamar la tool.
      else if (
        ![...executedTools].some((t) => DESTRUCTIVE_TOOLS.has(t)) &&
        DESTRUCTIVE_CLAIM_PATTERN.test(reply) &&
        DESTRUCTIVE_INTENT_PATTERN.test(findLastUserText(currentMessages))
      ) {
        correction =
          "[SISTEMA] No llamaste ninguna herramienta de eliminación/cancelación (delete_service o cancel_or_delete_appointment) todavía. Si ya tienes los datos para identificar qué eliminar/cancelar, llámala AHORA antes de confirmar. Si te faltan datos, pídelos de forma breve y natural — sin disculparte, sin mencionar herramientas, errores internos ni este mensaje. No digas que se eliminó/canceló algo si la herramienta no lo confirmó con success: true.";
      }
      // 1c) Claim de mensaje enviado sin ninguna tool que envíe WhatsApp.
      else if (
        ![...executedTools].some((t) => MESSAGE_SENDING_TOOLS.has(t)) &&
        MESSAGE_SENT_CLAIM_PATTERN.test(reply)
      ) {
        correction =
          "[SISTEMA] Afirmaste que enviaste un mensaje, pero en este turno no se envió ninguno: desde este chat NO existe forma de enviar mensajes sueltos de WhatsApp (solo se envían al crear, cancelar con aviso o reprogramar una cita). Reescribe tu respuesta sin afirmar el envío y explica cómo hacerlo desde la interfaz si aplica. No menciones herramientas ni este mensaje, y no empieces con \"Tienes razón\".";
      }
      // 1d) Claim de cliente registrado/actualizado sin tool de clientes.
      else if (
        ![...executedTools].some((t) => CLIENT_TOOLS.has(t)) &&
        CLIENT_CLAIM_PATTERN.test(reply)
      ) {
        correction =
          "[SISTEMA] Afirmaste que registraste o actualizaste clientes, pero en este turno no se ejecutó create_client, update_client ni create_appointments. Si tienes los datos, llama la herramienta AHORA (una vez por cliente) y reporta solo lo que devolvió con success: true; si no, reescribe sin afirmarlo. Para verificar si un cliente existe usa find_clients. No menciones herramientas ni este mensaje, y no empieces con \"Tienes razón\".";
      }
      // 2) Claim de política de reserva configurada sin update_booking_config —
      //    la política NO se guardó (queda en manual). Caso real de logs. Solo en
      //    onboarding: en modo soporte "tu política está configurada como X" es una
      //    respuesta informativa legítima y frecuente (falso positivo).
      else if (
        (!context.setupStatus.setupCompleted || POLICY_INTENT_PATTERN.test(findLastUserText(currentMessages))) &&
        !executedTools.has("update_booking_config") &&
        POLICY_CLAIM_PATTERN.test(reply)
      ) {
        correction =
          "[SISTEMA] No llamaste update_booking_config — la política de reserva NO ha sido guardada realmente. Llámala AHORA con requiresApproval según lo que eligió el usuario, y confirma después con el resultado real. No menciones herramientas ni este mensaje al usuario.";
      }
      // 1e) Claim sobre bloqueos de agenda sin bloquear/desbloquear/consultar con éxito.
      else if (
        ![...successfulTools].some((t) => BLOCK_TOOLS.has(t)) &&
        BLOCK_CLAIM_PATTERN.test(reply)
      ) {
        correction =
          "[SISTEMA] Afirmaste algo sobre bloqueos de agenda (bloqueado, desbloqueado, disponible, ya registrado) sin que una herramienta lo confirmara en este turno. Para BLOQUEAR usa block_employee_time; para QUITAR un bloqueo (marca roja) usa unblock_employee_time; para saber qué está bloqueado usa get_employee_blocks. Llama la correcta AHORA y responde solo con su resultado real; si te falta el profesional o la fecha, pídelo. No menciones herramientas ni este mensaje, y no empieces con \"Tienes razón\".";
      }
      // 2a) Claim de horario guardado sin update_schedule / block_employee_time.
      else if (
        ![...executedTools].some((t) => SCHEDULE_TOOLS.has(t)) &&
        isScheduleInput(findLastUserText(currentMessages)) &&
        SCHEDULE_CLAIM_PATTERN.test(reply)
      ) {
        correction =
          "[SISTEMA] Afirmaste que el horario quedó configurado, pero no llamaste update_schedule (horario semanal) ni block_employee_time (cambio puntual): el horario NO se guardó. Si ya tienes los días y horas, llama la herramienta correcta AHORA y confirma con el resultado real; si te falta algún dato, pídelo de forma breve. No menciones herramientas ni este mensaje, y no empieces con \"Tienes razón\".";
      }
      // 2b) Claim de color de marca aplicado sin update_primary_color.
      else if (
        !executedTools.has("update_primary_color") &&
        COLOR_INTENT_PATTERN.test(findLastUserText(currentMessages)) &&
        COLOR_CLAIM_PATTERN.test(reply)
      ) {
        correction =
          "[SISTEMA] Afirmaste que el color de marca quedó configurado, pero no llamaste update_primary_color: el color NO se guardó. Llámala AHORA con el hex del color que eligió el usuario y confirma con el resultado real. No menciones herramientas ni este mensaje, y no empieces con \"Tienes razón\".";
      }
      // 3) Claim de configuración completada sin mark_setup_complete (solo aplica
      //    mientras el setup siga incompleto) — el usuario quedaría atrapado
      //    rebotando al asistente de configuración en cada login.
      else if (
        !context.setupStatus.setupCompleted &&
        !executedTools.has("mark_setup_complete") &&
        SETUP_DONE_CLAIM_PATTERN.test(reply)
      ) {
        correction =
          "[SISTEMA] No llamaste mark_setup_complete — la configuración NO está marcada como completada y el usuario seguirá viendo el asistente de configuración al entrar. Llámala AHORA (requiere al menos un servicio y un profesional creados; si la herramienta devuelve error, continúa el paso que falte). No menciones herramientas ni este mensaje al usuario.";
      }

      if (correction && round < MAX_TOOL_ROUNDS - 1) {
        currentMessages = [
          ...currentMessages,
          { role: "assistant", content: response.content },
          { role: "user", content: correction },
        ];
        continue;
      }

      // Cierre determinista: no depender de que el modelo llame mark_setup_complete.
      const autoCompleted =
        !context.setupStatus.setupCompleted &&
        !executedTools.has("mark_setup_complete") &&
        (await autoCompleteSetupIfReady(context.organizationId));

      const invalidates =
        autoCompleted || [...executedTools].some((t) => ORG_INVALIDATING_TOOLS.has(t))
          ? ["organization"]
          : [];
      return {
        reply,
        invalidates,
        _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, hitRoundLimit: false, toolErrors, actions },
      };
    }

    // En SERIE y en el orden en que el modelo las pidió: suele pedir en una misma
    // ronda tools que dependen entre sí (create_employee + assign_services_to_employee,
    // bulk_create_services + assign...). Con Promise.all la asignación corría antes de
    // que existiera el profesional o los servicios — 6 onboardings entre el 5 y el 9
    // de nov-2026; Studio nails Heidy quedó con 1 de 7 servicios asignados mientras
    // el bot decía "con todos los servicios asignados".
    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    const toolResults = [];
    for (const block of toolUseBlocks) {
      executedTools.add(block.name);
      let result;
      try {
        result = await executeTool(block.name, block.input, context);
      } catch (err) {
        result = { success: false, error: err.message };
      }
      if (result?.success === false && result?.error) {
        toolErrors.push({ tool: block.name, error: String(result.error).slice(0, 300) });
      }
      if (result?.success !== false) successfulTools.add(block.name);
      const action = describeAdminToolAction(block.name, block.input, result);
      if (action) actions.push(action);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: response.content },
      { role: "user", content: toolResults },
    ];
  }

  const usedTools = [...executedTools];
  const manualHint = usedTools.includes("create_appointments")
    ? " Para crear la cita manualmente ve a Gestionar Agenda y usa el botón 'Crear cita'."
    : usedTools.includes("cancel_or_delete_appointment")
    ? " Para cancelar o eliminar la cita ve a Gestionar Agenda, haz clic sobre la cita y usa el menú de acciones."
    : "";

  // Aun agotando rondas, no perder el cierre determinista del onboarding —
  // las tools ejecutadas pudieron haber dejado el setup listo.
  const autoCompletedAtLimit =
    !context.setupStatus.setupCompleted &&
    !executedTools.has("mark_setup_complete") &&
    (await autoCompleteSetupIfReady(context.organizationId));

  return {
    reply: `No pude completar la operación en el tiempo disponible.${manualHint} Por favor intenta de nuevo con una solicitud más específica o realízalo directamente desde la interfaz.`,
    invalidates: autoCompletedAtLimit ? ["organization"] : [],
    _meta: { rounds, toolsUsed: usedTools, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, hitRoundLimit: true, toolErrors, actions },
  };
};
