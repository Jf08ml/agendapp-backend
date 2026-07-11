/**
 * waBookingAgentService.js
 *
 * Agente IA de reservas para CLIENTES vía WhatsApp (número Meta de la org).
 * Reutiliza el booking-chatbot (mismo cerebro que el asistente web público)
 * con canal "whatsapp": sin botón de confirmación — la reserva se crea con la
 * tool confirm_reservation cuando el cliente responde "sí".
 *
 * Se activa por org con Organization.waBookingAgentEnabled (default false).
 * El enrutamiento del mensaje entrante ocurre en waAgentController.handleMetaIncoming.
 */

import { randomUUID } from "crypto";
import { processBookingChat } from "../booking-chatbot/bookingChatService.js";
import whatsappService from "./sendWhatsappService.js";
import ChatLog from "../models/chatLogModel.js";

// Sesión expira tras 30 min de inactividad (misma política que el agente admin)
const SESSION_TTL_MS = 30 * 60 * 1000;
// Máximo de mensajes de texto en el historial por sesión
const MAX_HISTORY = 30;
// Nota interna (historial + ChatLog) cuando el bot decide no responder —
// nunca se envía al cliente por WhatsApp.
const NO_REPLY_NOTE = "(sin respuesta — mensaje sin intención de agendar)";

// Historial en memoria: `${orgId}:${clientPhone}` →
// { messages, lastActivity, sessionId, pendingPayload, reservationCreated }
const sessions = new Map();

function getOrCreateSession(orgId, clientPhone) {
  const key = `${orgId}:${clientPhone}`;
  const now = Date.now();
  const existing = sessions.get(key);
  if (existing && now - existing.lastActivity > SESSION_TTL_MS) {
    sessions.delete(key);
  }
  if (!sessions.has(key)) {
    sessions.set(key, {
      messages: [],
      lastActivity: now,
      sessionId: randomUUID(),
      pendingPayload: null,
      reservationCreated: false,
    });
  }
  const session = sessions.get(key);
  session.lastActivity = now;
  return session;
}

// Limpieza periódica de sesiones muertas para no acumular memoria
setInterval(() => {
  const now = Date.now();
  for (const [key, s] of sessions.entries()) {
    if (now - s.lastActivity > SESSION_TTL_MS) sessions.delete(key);
  }
}, SESSION_TTL_MS).unref();

/**
 * Procesa un mensaje entrante de un cliente al número Meta de la org
 * y responde por el mismo canal.
 *
 * @param {Object} org         - Organization (lean)
 * @param {string} clientPhone - Teléfono del cliente en E.164 (+57...)
 * @param {string} body        - Texto del mensaje
 */
export async function processClientBookingMessage(org, clientPhone, body) {
  const orgId = org._id.toString();
  const startedAt = Date.now();

  console.log(
    `[WaBookingAgent] Mensaje de cliente — org: ${org.name} — ${clientPhone} — "${body.slice(0, 80)}"`
  );

  const session = getOrCreateSession(orgId, clientPhone);
  session.messages.push({ role: "user", content: body });

  let reply;
  let meta = {};
  let errorMsg = null;
  let noReply = false;

  try {
    const result = await processBookingChat(org, session.messages, {
      channel: "whatsapp",
      session,
      sessionId: session.sessionId,
      clientPhone,
    });
    noReply = result.noReply === true;
    reply = noReply ? NO_REPLY_NOTE : (result.reply || "¿En qué puedo ayudarte con tu reserva?");
    meta = result._meta || {};
  } catch (err) {
    console.error("[WaBookingAgent] Error en processBookingChat:", err);
    errorMsg = err.message;
    reply =
      "Lo siento, tuve un problema procesando tu mensaje. Intenta de nuevo en un momento.";
  }

  session.messages.push({ role: "assistant", content: reply });
  if (session.messages.length > MAX_HISTORY) {
    session.messages = session.messages.slice(-MAX_HISTORY);
  }

  // Mensaje sin intención de agendar (ver FILTRO DE INTENCIÓN del prompt) —
  // no se envía nada al cliente, solo queda registrado en el historial/ChatLog.
  if (!noReply) {
    try {
      await whatsappService.sendMessage(orgId, clientPhone, reply);
    } catch (err) {
      console.error(`[WaBookingAgent] Error enviando respuesta a ${clientPhone}:`, err.message);
    }
  } else {
    console.log(`[WaBookingAgent] Sin respuesta (fuera de intención de agendar) — ${clientPhone}`);
  }

  // Persistir en ChatLog (mismo esquema que el booking chat web) — fire-and-forget
  const reservationJustCreated = session.reservationCreated === true;
  if (reservationJustCreated) session.reservationCreated = false; // one-shot

  const update = {
    $setOnInsert: {
      organizationId: org._id,
      type: "booking",
      channel: "whatsapp",
    },
    $push: {
      messages: {
        $each: [
          { role: "user", content: body },
          { role: "assistant", content: reply },
        ],
      },
    },
    $set: {
      reply,
      durationMs: Date.now() - startedAt,
      ...(session.pendingPayload ? { bookingPayload: session.pendingPayload } : {}),
      ...(reservationJustCreated
        ? { reservationCreated: true, reservationCreatedAt: new Date() }
        : {}),
      ...(meta.hitRoundLimit ? { hitRoundLimit: true } : {}),
      ...(errorMsg ? { error: errorMsg } : {}),
    },
    $inc: {
      rounds: meta.rounds || 0,
      inputTokens: meta.inputTokens || 0,
      outputTokens: meta.outputTokens || 0,
    },
    ...(meta.toolsUsed?.length ? { $addToSet: { toolsUsed: { $each: meta.toolsUsed } } } : {}),
  };

  ChatLog.findOneAndUpdate({ sessionId: session.sessionId }, update, {
    upsert: true,
    new: false,
  }).catch((err) =>
    console.error("[WaBookingAgent] Error guardando ChatLog:", err.message)
  );
}
