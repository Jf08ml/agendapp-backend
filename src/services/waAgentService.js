import Anthropic from "@anthropic-ai/sdk";
import WaConversation from "../models/waConversationModel.js";
import Organization from "../models/organizationModel.js";
import { sendTextMessage } from "./metaApiService.js";
import { startDialogue, continueDialogue } from "./waAgentDialogueService.js";

const client = new Anthropic();

// Ventana de silencio: si no llega un mensaje nuevo en este tiempo, se analiza la conv
const SILENCE_WINDOW_MS = 45_000;

// Debounce en memoria: convId → timeoutHandle
// Sobrevive reinicios del proceso (si el servidor se reinicia, la próxima vez
// que llegue un mensaje de esa conv reinicia el timer igualmente)
const analyzeDebounce = new Map();

// ─── Entrada desde Baileys ───────────────────────────────────────────────────

export async function processIncomingMessage({ orgPhone, clientPhone, fromMe, body, timestamp }) {
  const org = await Organization.findOne({ waPhone: orgPhone }).lean();
  if (!org) {
    console.warn(`[WaAgent] orgPhone no registrado: ${orgPhone}`);
    return;
  }
  if (!org.waAgentEnabled) {
    console.log(`[WaAgent] Agente deshabilitado para org: ${org._id}`);
    return;
  }

  const role = fromMe ? "org" : "client";
  const messageTs = timestamp ? new Date(Number(timestamp) * 1000) : new Date();

  const convo = await WaConversation.findOneAndUpdate(
    {
      orgPhone,
      clientPhone,
      status: { $in: ["monitoring", "intent_detected"] },
    },
    {
      $setOnInsert: { organizationId: org._id },
      $push: { messages: { role, body, timestamp: messageTs } },
      $set: { lastActivityAt: new Date() },
    },
    { upsert: true, new: true }
  );

  console.log(`[WaAgent] Mensaje (${role}) — org: ${orgPhone}, cliente: ${clientPhone}`);

  // Si ya hay un resumen enviado esperando respuesta, ignorar mensajes nuevos
  if (convo.status === "summary_sent") return;

  scheduleAnalysis(convo._id.toString(), orgPhone, clientPhone);
}

// ─── Entrada desde Meta (respuesta del admin de la org) ─────────────────────

export async function processOrgResponse({ orgPhone, body }) {
  const convo = await WaConversation.findOne({
    orgPhone,
    status: "summary_sent",
  }).sort({ lastActivityAt: -1 });

  if (!convo) {
    console.warn(`[WaAgent] Respuesta de org sin conversación pendiente: ${orgPhone}`);
    return;
  }

  const org = await Organization.findById(convo.organizationId).lean();
  if (!org) return;

  console.log(`[WaAgent] Admin respondió: "${body}" — conv: ${convo._id}`);

  await continueDialogue(convo, org, body).catch((err) =>
    console.error("[WaAgent] Error en continueDialogue:", err)
  );
}

// ─── Ventana de silencio ─────────────────────────────────────────────────────

function scheduleAnalysis(convId, orgPhone, clientPhone) {
  // Cancelar el timer anterior si llegó otro mensaje antes de los 45s
  if (analyzeDebounce.has(convId)) {
    clearTimeout(analyzeDebounce.get(convId));
  }

  const handle = setTimeout(async () => {
    analyzeDebounce.delete(convId);
    await runLLMAnalysis(convId).catch((err) =>
      console.error("[WaAgent] Error en análisis LLM:", err)
    );
  }, SILENCE_WINDOW_MS);

  analyzeDebounce.set(convId, handle);
  console.log(`[WaAgent] Análisis programado en ${SILENCE_WINDOW_MS / 1000}s — conv: ${convId}`);
}

// ─── Análisis LLM ────────────────────────────────────────────────────────────

async function runLLMAnalysis(convId) {
  const convo = await WaConversation.findById(convId);
  if (!convo) return;
  if (convo.status === "summary_sent") return; // ya se notificó, no repetir

  // Necesitamos al menos un mensaje del cliente para analizar
  const clientMessages = convo.messages.filter((m) => m.role === "client");
  if (clientMessages.length === 0) return;

  const org = await Organization.findById(convo.organizationId).lean();
  if (!org) return;

  const conversationText = convo.messages
    .map((m) => `${m.role === "client" ? "Cliente" : "Negocio"}: ${m.body}`)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: [
      {
        type: "text",
        text: `Eres un asistente que analiza conversaciones de WhatsApp de negocios de belleza y servicios.
Tu única tarea es detectar si el cliente está solicitando una cita o turno.
Responde SOLO con JSON válido. No uses bloques de código, no uses markdown, no agregues texto antes ni después del JSON.`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Conversación de WhatsApp:\n${conversationText}\n\n¿El cliente está solicitando una cita? Responde exactamente con este JSON:
{
  "intent": "book_appointment" o "none",
  "confidence": "high" o "medium" o "low",
  "serviceHint": "nombre del servicio mencionado, o null",
  "dateHint": "fecha u hora mencionada, o null",
  "employeeHint": "empleada o persona mencionada, o null"
}`,
      },
    ],
  });

  let intent;
  try {
    intent = JSON.parse(extractJSON(response.content[0].text));
  } catch {
    console.error("[WaAgent] LLM no devolvió JSON válido:", response.content[0].text);
    return;
  }

  console.log(`[WaAgent] Intención detectada:`, intent);

  if (intent.intent !== "book_appointment") return;
  if (intent.confidence === "low") return;

  await WaConversation.findByIdAndUpdate(convId, {
    status: "intent_detected",
    detectedIntent: {
      serviceHint: intent.serviceHint,
      dateHint: intent.dateHint,
      employeeHint: intent.employeeHint,
      confidence: intent.confidence === "high" ? 0.9 : 0.6,
    },
  });

  const freshConvo = await WaConversation.findById(convId).lean();
  await startDialogue(freshConvo, org, intent);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Normaliza un número local a E.164 asumiendo Colombia (+57)
// Si ya tiene el +, lo deja como está
export function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("57") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+57${digits}`;
  return `+${digits}`;
}

// Limpia sufijos de JID de Baileys: @s.whatsapp.net, @lid, @c.us, etc.
export function sanitizePhone(jid) {
  return jid ? jid.replace(/@.+$/, "") : jid;
}

// Extrae JSON de una respuesta que puede venir envuelta en bloques markdown
function extractJSON(text) {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return match ? match[1].trim() : text.trim();
}
