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

Capacidades:
- Consultar citas por cliente, fecha, estado o profesional (query_appointments)
- Ver ingresos y comisiones por período (query_revenue)
- Crear citas para clientes existentes (create_appointments)
- Cancelar o eliminar citas (cancel_or_delete_appointment)

Reglas:
- Responde en español con mensajes CORTOS y directos para WhatsApp (máximo 5 líneas).
- FORMATO: usa solo texto plano. Para resaltar algo escribe *texto* (un asterisco). NUNCA uses **doble asterisco**, # encabezados ni otros símbolos Markdown — WhatsApp los muestra como caracteres literales.
- Usa emojis moderadamente para claridad (✅, ❌, 📅).
- Cuando tengas los datos para ejecutar una acción, ejecuta la herramienta INMEDIATAMENTE — no anuncies que lo harás.
- Convierte siempre horas a HH:mm (24h) y fechas a YYYY-MM-DD usando las referencias de arriba.
- Si el cliente no existe, informa que no se encontró y sugiere crearlo desde Gestionar Clientes en AgenditApp.
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
