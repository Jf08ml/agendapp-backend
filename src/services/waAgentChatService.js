import Anthropic from "@anthropic-ai/sdk";
import moment from "moment-timezone";
import { sendTextMessage } from "./metaApiService.js";
import { claudeTools, executeTool } from "../chatbot/toolRegistry.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;
const MAX_TOOL_ROUNDS = 8;
// Sesión expira tras 30 min de inactividad
const SESSION_TTL_MS = 30 * 60 * 1000;
// Máximo de mensajes en el historial por sesión
const MAX_HISTORY = 20;

// Historial en memoria: orgId → { messages: [{role, content}], lastActivity }
const sessions = new Map();

function getOrCreateSession(orgId) {
  const now = Date.now();
  const existing = sessions.get(orgId);
  if (existing && now - existing.lastActivity > SESSION_TTL_MS) {
    sessions.delete(orgId);
  }
  if (!sessions.has(orgId)) {
    sessions.set(orgId, { messages: [], lastActivity: now });
  }
  const session = sessions.get(orgId);
  session.lastActivity = now;
  return session;
}

function buildSystemPrompt(org) {
  const tz = org.timezone || "America/Bogota";
  const now = moment.tz(tz);
  const dow = now.day();

  const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const fmtRef = (d) => `${d.format("YYYY-MM-DD")} (${DAY_NAMES[d.day()]} ${d.date()} de ${MONTH_NAMES[d.month()]})`;
  const nextOcc = (targetDow) => {
    let diff = targetDow - dow;
    if (diff < 0) diff += 7;
    return now.clone().add(diff, "days");
  };

  const dateRefs = [
    ["hoy", now.clone()],
    ["mañana", now.clone().add(1, "days")],
    ...DAY_NAMES.map((name, i) => [`este ${name} / el ${name}`, nextOcc(i)]),
    ["próxima semana (lunes)", now.clone().add(7 - dow + 1, "days")],
  ];
  const dateRefsBlock = dateRefs.map(([l, d]) => `  - "${l}" → ${fmtRef(d)}`).join("\n");

  return `Eres el asistente de agenda de ${org.name} vía WhatsApp. Recibes comandos directos del administrador del negocio.

Organización: ${org.name}
Zona horaria: ${tz}
Fecha actual: ${now.format("YYYY-MM-DD")}

Referencias de fechas (zona ${tz}) — NUNCA calcules estas fechas tú mismo:
${dateRefsBlock}

═══ CITAS ═══
- *Consultar* (query_appointments): citas por cliente, profesional, fecha, estado o pago. Sin período → usa today.
- *Ingresos* (query_revenue): facturación y comisiones por período. Agrupa por employee/service/day.
- *Crear* (create_appointments): necesitas cliente, servicio, profesional, fecha y hora (HH:mm 24h, YYYY-MM-DD). Si el cliente no existe y tienes su teléfono lo crea automáticamente. Si solo tienes el nombre, pide el teléfono. Si hay solapamiento avisa pero crea igual.
- *Reprogramar* (reschedule_appointment): necesitas cliente, nueva fecha y hora. Incluye la fecha actual si el cliente tiene varias citas para afinar. Si hay solapamiento avisa pero reprograma igual.
- *Cancelar/Eliminar* (cancel_or_delete_appointment): "cancela" → action:cancel. "cancela y avisa" → notifyClient:true. "elimina" → action:delete. Si hay múltiples resultados devuelve lista para que especifiques.

═══ SERVICIOS ═══
- *Listar* (get_services): muestra los servicios activos del negocio.
- *Crear* (create_service): necesitas nombre, duración (min) y precio. Tipo/categoría es opcional.

═══ PROFESIONALES ═══
- *Listar* (get_employees): muestra los profesionales activos.
- *Crear* (create_employee): necesitas nombre, cargo, email y teléfono. Muestra la contraseña temporal generada.
- *Asignar servicios* (assign_services_to_employee): indica el profesional y los servicios que atenderá.

═══ CONFIGURACIÓN ═══
- *Horario* (update_schedule): días y horas de atención. Pide días y horarios en lenguaje natural.
- *Política de reservas* (update_booking_config): manual (requiresApproval:true) o automática (requiresApproval:false).
- *Color* (update_primary_color): color principal del branding (hex o nombre).
- *Estado de configuración* (get_setup_status): revisa qué tiene configurado el negocio.

Reglas:
- Responde en español con mensajes CORTOS y directos para WhatsApp (máximo 5 líneas).
- FORMATO: usa solo texto plano. Para resaltar algo escribe *texto* (un solo asterisco). NUNCA uses **doble asterisco**, # encabezados ni otros símbolos Markdown.
- Usa emojis moderadamente (✅, ❌, 📅).
- Cuando tengas los datos para ejecutar una acción, ejecuta la herramienta INMEDIATAMENTE sin anunciarlo.
- Convierte fechas a YYYY-MM-DD usando las referencias de arriba. Convierte horas a HH:mm (24h).
- Nunca inventes datos. Si falta información, pregunta solo lo que necesitas.`;
}

export async function processAdminCommand(org, messageBody) {
  const orgId = org._id.toString();

  const adminPhone = normalizeAdminPhone(org.phoneNumber);
  if (!adminPhone) {
    console.warn(`[WaAgentChat] org ${orgId} no tiene phoneNumber configurado`);
    return;
  }

  console.log(`[WaAgentChat] Comando del admin — org: ${org.name} — "${messageBody.slice(0, 80)}"`);

  const session = getOrCreateSession(orgId);
  session.messages.push({ role: "user", content: messageBody });

  const context = { organizationId: org._id, organization: org };
  const systemPrompt = buildSystemPrompt(org);

  let currentMessages = [...session.messages];
  let finalReply = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const toolsWithCache = claudeTools.map((t, i) =>
      i === claudeTools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t
    );

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      tools: toolsWithCache,
      messages: currentMessages,
    });

    if (response.stop_reason !== "tool_use") {
      const textBlock = response.content.find((b) => b.type === "text");
      finalReply = textBlock?.text || "Listo.";
      break;
    }

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        let result;
        try {
          result = await executeTool(block.name, block.input, context);
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

  if (!finalReply) {
    finalReply = "No pude completar la operación. Intenta de nuevo o hazlo desde AgenditApp.";
  }

  // Guardar en historial y recortar si es necesario
  session.messages.push({ role: "assistant", content: finalReply });
  if (session.messages.length > MAX_HISTORY) {
    session.messages = session.messages.slice(-MAX_HISTORY);
  }

  try {
    await sendTextMessage(adminPhone, toWhatsAppFormat(finalReply));
    console.log(`[WaAgentChat] Respuesta enviada — org: ${org.name}: "${finalReply.slice(0, 80)}"`);
  } catch (err) {
    console.error(`[WaAgentChat] Error enviando respuesta — org: ${org.name}:`, err.message);
  }
}

function normalizeAdminPhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("57") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+57${digits}`;
  return `+${digits}`;
}

// Convierte Markdown de Claude a formato WhatsApp:
//   **negrita** → *negrita*   (WA usa un solo asterisco)
//   ### encabezado → encabezado  (WA no tiene headers)
function toWhatsAppFormat(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "*$1*")   // **bold** → *bold*
    .replace(/^#{1,6}\s+/gm, "");         // ### heading → heading
}
