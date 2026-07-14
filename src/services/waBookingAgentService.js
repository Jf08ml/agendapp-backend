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

// ── Pausa del bot por comando del cliente ────────────────────────────────────
// Permite que un cliente silencie al bot en su chat (ej: el número también se
// usa para contactos personales del negocio) y lo reactive cuando quiera agendar.
const PAUSE_HOURS = 24;
const PAUSE_TTL_MS = PAUSE_HOURS * 60 * 60 * 1000;
const PAUSE_COMMANDS = new Set(["pausar", "pausar bot", "pausa", "pausa bot", "detener bot"]);
const RESUME_COMMANDS = new Set(["agendar", "reservar", "activar bot", "reactivar", "reactivar bot"]);
const PAUSE_ACK_MESSAGE = `Listo, no te voy a escribir por las próximas ${PAUSE_HOURS} horas 🤫. Si quieres agendar antes, respóndeme *AGENDAR*.`;
const PAUSE_HINT_SUFFIX = `\n\n_Si no eres cliente o prefieres que no te escriba por un rato, respóndeme *PAUSAR* y no te enviaré mensajes en ${PAUSE_HOURS} horas._`;

// Normaliza para comparar comandos: minúsculas, sin tildes, sin signos.
function normalizeCommand(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[¡!¿?.,]/g, "")
    .trim();
}

// `${orgId}:${clientPhone}` → timestamp (ms) hasta cuándo está pausado.
// Deliberadamente separado de `sessions`: una pausa de horas debe sobrevivir
// aunque el cliente no escriba nada en ese tiempo (`sessions` sí expira a los
// 30 min de inactividad).
const pausedClients = new Map();

function getPauseUntil(key) {
  const until = pausedClients.get(key);
  if (!until) return null;
  if (Date.now() >= until) {
    pausedClients.delete(key);
    return null;
  }
  return until;
}

// Limpieza periódica de pausas expiradas para no acumular memoria.
setInterval(() => {
  const now = Date.now();
  for (const [key, until] of pausedClients.entries()) {
    if (now >= until) pausedClients.delete(key);
  }
}, PAUSE_TTL_MS).unref();

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
  const pauseKey = `${orgId}:${clientPhone}`;

  const normalized = normalizeCommand(body);
  const isPauseCommand = PAUSE_COMMANDS.has(normalized);
  const isResumeCommand = RESUME_COMMANDS.has(normalized);
  const pausedUntil = getPauseUntil(pauseKey);

  // El cliente pausó el bot explícitamente — no lo interrumpimos ni gastamos IA,
  // salvo que este mensaje sea justo el comando de reactivación.
  if (pausedUntil && !isResumeCommand) {
    console.log(
      `[WaBookingAgent] Ignorado (pausado hasta ${new Date(pausedUntil).toISOString()}) — ${clientPhone}`
    );
    return;
  }
  if (isResumeCommand && pausedUntil) {
    pausedClients.delete(pauseKey);
  }

  console.log(
    `[WaBookingAgent] Mensaje de cliente — org: ${org.name} — ${clientPhone} — "${body.slice(0, 80)}"`
  );

  const session = getOrCreateSession(orgId, clientPhone);
  const isFirstMessageInSession = session.messages.length === 0;
  session.messages.push({ role: "user", content: body });

  let reply;
  let meta = {};
  let errorMsg = null;
  let noReply = false;

  if (isPauseCommand) {
    // Comando de pausa: respuesta fija (no depende del modelo) para garantizar
    // el texto exacto, y sin invocar al asistente en absoluto.
    reply = PAUSE_ACK_MESSAGE;
    pausedClients.set(pauseKey, Date.now() + PAUSE_TTL_MS);
  } else {
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

    // Primer mensaje de la sesión: informar del comando de pausa junto al saludo.
    if (isFirstMessageInSession && !noReply && reply) {
      reply += PAUSE_HINT_SUFFIX;
    }
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
