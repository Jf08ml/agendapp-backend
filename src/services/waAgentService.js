import Anthropic from "@anthropic-ai/sdk";
import WaConversation from "../models/waConversationModel.js";
import Organization from "../models/organizationModel.js";
import { sendTextMessage } from "./metaApiService.js";
import { startDialogue, continueDialogue } from "./waAgentDialogueService.js";

const client = new Anthropic();

// Ventana de silencio: si no llega un mensaje nuevo en este tiempo, se analiza la conv
const SILENCE_WINDOW_MS = 45_000;

// Tiempo máximo esperando que el admin reactive la ventana de 24h respondiendo
// la plantilla "re_activacion_ia". Esa plantilla no lleva contexto (Meta no
// permite texto libre con la ventana cerrada), así que es fácil que el admin
// la ignore sin saber que hay una solicitud pendiente — sin este timeout la
// conversación queda atascada para siempre y bloquea cualquier solicitud nueva
// del cliente (los mensajes nuevos se acumulan pero nunca se re-analizan).
const AWAITING_REOPEN_TIMEOUT_MS = 3 * 60 * 60 * 1000; // 3 horas

// Debounce en memoria: convId → timeoutHandle
// Sobrevive reinicios del proceso (si el servidor se reinicia, la próxima vez
// que llegue un mensaje de esa conv reinicia el timer igualmente)
const analyzeDebounce = new Map();

// ─── Entrada desde Baileys ───────────────────────────────────────────────────

export async function processIncomingMessage({ orgPhone, clientPhone, fromMe, body, timestamp }) {
  // El canal Meta entrega el teléfono de la org en su formato de despliegue
  // (con espacios, ej. "+57 321 8104634"), mientras que `waPhone` se guarda en
  // E.164 (ej. "+573218104634"). A diferencia de `normalizePhone` (que asume
  // Colombia para números locales de 10 dígitos), aquí solo limpiamos el
  // formato: el número que llega ya es internacional completo (Meta siempre
  // incluye el código de país), así que adivinar el país sería incorrecto
  // — p.ej. un número de Singapur (+65 + 8 dígitos = 10 dígitos) terminaría
  // con un "+57" agregado por error. Esto también unifica `orgPhone` entre
  // canales (Baileys/Meta) para evitar conversaciones duplicadas.
  orgPhone = `+${orgPhone.replace(/\D/g, "")}`;
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

  await expireStaleAwaitingReopen(orgPhone, clientPhone);

  const convo = await WaConversation.findOneAndUpdate(
    {
      orgPhone,
      clientPhone,
      // Incluye "summary_sent": si ya se notificó al admin y el cliente sigue
      // escribiendo, el mensaje debe sumarse a esa MISMA conversación (no crear
      // una nueva vía upsert) — así el guard de abajo evita re-disparar el
      // análisis/notificación mientras el admin no haya respondido o concluido.
      status: { $in: ["monitoring", "intent_detected", "summary_sent"] },
    },
    {
      $setOnInsert: { organizationId: org._id },
      $push: { messages: { role, body, timestamp: messageTs } },
      $set: { lastActivityAt: new Date() },
    },
    { upsert: true, new: true }
  );

  console.log(
    `[WaAgent] (1) RECEPCIÓN — mensaje (${role}) — conv: ${convo._id}, status: ${convo.status}, ` +
    `org: ${orgPhone}, cliente: ${clientPhone}, texto: "${body.slice(0, 100)}"`
  );

  // Si ya hay un resumen enviado esperando respuesta, ignorar mensajes nuevos
  if (convo.status === "summary_sent") {
    console.log(`[WaAgent] (1) RECEPCIÓN — conv ${convo._id} en espera de respuesta del admin, mensaje no dispara nuevo análisis`);
    return;
  }

  scheduleAnalysis(convo._id.toString(), orgPhone, clientPhone);
}

// ─── Entrada desde Meta (respuesta del admin de la org) ─────────────────────

export async function processOrgResponse({ orgPhone, body }) {
  // orgPhone = teléfono personal del admin (org.phoneNumber).
  // Las conversaciones se guardan con orgPhone = org.waPhone (Baileys), que puede diferir.
  // Buscamos por organizationId para no depender de qué número se usó en cada canal.
  // phoneNumber puede estar sin código de país ("3218104634") mientras que
  // waPhone suele estar en E.164 ("+573218104634") — buscamos en ambos campos.
  const phoneVariants = [orgPhone, orgPhone.replace(/^\+/, "")];
  const org = await Organization.findOne({
    $or: [
      { phoneNumber: { $in: phoneVariants } },
      { waPhone: { $in: phoneVariants } },
    ],
    waAgentEnabled: true,
  }).lean();

  if (!org) {
    console.warn(`[WaAgent] (4) RESPUESTA ADMIN — no se encontró organización para el teléfono ${orgPhone} (variantes: ${phoneVariants.join(", ")})`);
    return;
  }

  const convo = await WaConversation.findOne({
    organizationId: org._id,
    status: "summary_sent",
  }).sort({ lastActivityAt: -1 });

  if (!convo) {
    console.warn(`[WaAgent] (4) RESPUESTA ADMIN — org "${org.name}" (${org._id}) respondió pero no hay ninguna conversación en estado "summary_sent" — el mensaje del admin se ignora`);
    return;
  }

  console.log(`[WaAgent] (4) RESPUESTA ADMIN — "${body.slice(0, 100)}" — conv: ${convo._id}, org: ${org.name}`);

  await continueDialogue(convo, org, body).catch((err) =>
    console.error(`[WaAgent] (4) RESPUESTA ADMIN — error procesando respuesta del admin — conv: ${convo._id}:`, err)
  );
}

// ─── Expiración de espera de reactivación de ventana ────────────────────────

// Si una conversación lleva demasiado tiempo esperando que el admin reactive
// la ventana de 24h (respondiendo la plantilla "re_activacion_ia") y nunca lo
// hizo, la marcamos "expired" para liberar el slot — así un mensaje nuevo del
// cliente puede crear/usar una conversación fresca y disparar un análisis real
// en lugar de quedar enterrado detrás de una espera que nunca se va a resolver.
async function expireStaleAwaitingReopen(orgPhone, clientPhone) {
  const cutoff = new Date(Date.now() - AWAITING_REOPEN_TIMEOUT_MS);
  const stale = await WaConversation.findOneAndUpdate(
    {
      orgPhone,
      clientPhone,
      status: "summary_sent",
      awaitingWindowReopen: true,
      awaitingWindowReopenSince: { $lte: cutoff },
    },
    { status: "expired" }
  );

  if (stale) {
    console.log(
      `[WaAgent] conv ${stale._id} expiró — el admin nunca reactivó la ventana de 24h ` +
      `respondiendo "re_activacion_ia" (>${AWAITING_REOPEN_TIMEOUT_MS / 3_600_000}h sin respuesta) — se libera para nuevo análisis`
    );
  }
}

// ─── Ventana de silencio ─────────────────────────────────────────────────────

function scheduleAnalysis(convId, orgPhone, clientPhone) {
  // Cancelar el timer anterior si llegó otro mensaje antes de los 45s
  if (analyzeDebounce.has(convId)) {
    clearTimeout(analyzeDebounce.get(convId));
    console.log(`[WaAgent] (2) ANÁLISIS — temporizador reiniciado por nuevo mensaje — conv: ${convId}`);
  }

  const handle = setTimeout(async () => {
    analyzeDebounce.delete(convId);
    await runLLMAnalysis(convId).catch((err) =>
      console.error(`[WaAgent] (2) ANÁLISIS — error inesperado analizando conv ${convId}:`, err)
    );
  }, SILENCE_WINDOW_MS);

  analyzeDebounce.set(convId, handle);
  console.log(`[WaAgent] (2) ANÁLISIS — programado en ${SILENCE_WINDOW_MS / 1000}s de silencio — conv: ${convId}`);
}

// ─── Análisis LLM ────────────────────────────────────────────────────────────

async function runLLMAnalysis(convId) {
  const convo = await WaConversation.findById(convId);
  if (!convo) {
    console.log(`[WaAgent] (2) ANÁLISIS — conversación ${convId} ya no existe (expiró/borrada), se omite`);
    return;
  }
  if (convo.status === "summary_sent") {
    console.log(`[WaAgent] (2) ANÁLISIS — conv ${convId} ya tiene resumen enviado, no se repite el análisis`);
    return; // ya se notificó, no repetir
  }

  // Necesitamos al menos un mensaje del cliente para analizar
  const clientMessages = convo.messages.filter((m) => m.role === "client");
  if (clientMessages.length === 0) {
    console.log(`[WaAgent] (2) ANÁLISIS — conv ${convId} sin mensajes del cliente todavía, se omite`);
    return;
  }

  const org = await Organization.findById(convo.organizationId).lean();
  if (!org) {
    console.warn(`[WaAgent] (2) ANÁLISIS — organización ${convo.organizationId} no encontrada — conv: ${convId}`);
    return;
  }

  console.log(`[WaAgent] (2) ANÁLISIS — analizando intención del cliente con LLM — conv: ${convId}, org: ${org.name}`);

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
Tu única tarea es detectar si el cliente está solicitando agendar, cancelar o reprogramar una cita o turno.
Responde SOLO con JSON válido. No uses bloques de código, no uses markdown, no agregues texto antes ni después del JSON.`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Conversación de WhatsApp:\n${conversationText}\n\n¿Qué quiere hacer el cliente? Responde exactamente con este JSON:
{
  "intent": "book_appointment" o "cancel_appointment" o "reschedule_appointment" o "none",
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
    console.error(`[WaAgent] (2) ANÁLISIS — el LLM no devolvió JSON válido — conv: ${convId}:`, response.content[0].text);
    return;
  }

  console.log(`[WaAgent] (2) ANÁLISIS — resultado del LLM — conv: ${convId}:`, intent);

  const ACTIONABLE_INTENTS = {
    book_appointment: "book",
    cancel_appointment: "cancel",
    reschedule_appointment: "reschedule",
  };
  const intentType = ACTIONABLE_INTENTS[intent.intent];
  if (!intentType) {
    console.log(`[WaAgent] (2) ANÁLISIS — sin intención accionable ("${intent.intent}") — no se inicia diálogo — conv: ${convId}`);
    return;
  }
  if (intent.confidence === "low") {
    console.log(`[WaAgent] (2) ANÁLISIS — confianza baja, se descarta para evitar falsos positivos — conv: ${convId}`);
    return;
  }

  console.log(`[WaAgent] (2) ANÁLISIS — intención accionable "${intentType}" (confianza: ${intent.confidence}) — pasando a diálogo con el admin — conv: ${convId}`);

  await WaConversation.findByIdAndUpdate(convId, {
    status: "intent_detected",
    detectedIntent: {
      type: intentType,
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
