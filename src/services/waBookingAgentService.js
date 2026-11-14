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
import { MAX_ACTION_LOG } from "../booking-chatbot/actionLog.js";
import whatsappService from "./sendWhatsappService.js";
import ChatLog from "../models/chatLogModel.js";
import WaBotPause from "../models/waBotPauseModel.js";
import Order from "../models/orderModel.js";
import notificationService from "./notificationService.js";
import subscriptionService from "./subscriptionService.js";
import { downloadMedia } from "./metaTemplateService.js";
import { transcribeAudio, MAX_AUDIO_BYTES } from "./audioTranscriptionService.js";

// Sesión expira tras 6 h de inactividad. Con 30 min (antes) los clientes que
// contestaban más tarde ("en la mañana", "ok") caían en una sesión nueva: el bot
// los saludaba de cero y perdía el servicio/horario que ya habían elegido.
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
// Máximo de mensajes de texto en el historial por sesión
const MAX_HISTORY = 30;
// Nota interna (historial + ChatLog) cuando el bot decide no responder —
// nunca se envía al cliente por WhatsApp.
const NO_REPLY_NOTE = "(sin respuesta — mensaje sin intención de agendar)";
const HANDOFF_NOTE = "(pasado al equipo del negocio — notificación enviada)";
// Una sola notificación al negocio por cliente en este lapso (varios mensajes
// seguidos del mismo cliente son la misma conversación).
const HANDOFF_NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;

// "ya pagué", "ya envié el comprobante", "ya lo subí", "ya transferí"...
const PAYMENT_CLAIM_PATTERN =
  /\b(pagu[eé]|pag[oó]|envi[eé]|mand[eé]|sub[ií]|transfer[ií]|consign[eé]|deposit[eé])\b|comprobante/i;

// Pide los datos para pagar ("mande el número de cuenta", "a qué cuenta
// transfiero", "no tengo los datos"). Va ANTES que PAYMENT_CLAIM_PATTERN: "Mande
// el número de cuenta" matcheaba "mandé" y la clienta recibió "Aún no nos llega tu
// comprobante" (Diana Vargas, 2026-11-03 — el abono venció sin pagar).
const ASKS_PAYMENT_DETAILS_PATTERN =
  /\b(n[uú]mero|n[°º]|datos)\s+(de\s+(la\s+)?)?(cuenta|transferencia|pago)|\bcuenta\s+(bancaria|para|de\s+ahorros|corriente)|\b(a\s+)?(qu[eé]|cu[aá]l)\s+cuenta\b|\bd[oó]nde\s+(transfiero|pago|deposito|consigno)|\bc[oó]mo\s+(pago|transfiero|hago\s+el\s+(pago|abono))/i;

// Para transferencia: datos en el chat + enlace para subir el comprobante.
const depositPayText = (deposit) =>
  deposit.method !== "mercadopago" && deposit.transferDetails
    ? `Puedes transferir el abono de *${deposit.amountLabel}* a:\n\n${deposit.transferDetails}\n\n` +
      `📎 Después sube la foto del comprobante aquí:\n${deposit.paymentUrl}`
    : `${deposit.method === "mercadopago" ? "Págalo" : "Ahí ves los datos para transferir y subes el comprobante"} en este enlace:\n${deposit.paymentUrl}`;

const notPaidYetReply = (deposit) =>
  `Aún no nos llega tu ${deposit.method === "mercadopago" ? "pago" : "comprobante"} 🙏 ` +
  (deposit.method !== "mercadopago" && deposit.transferDetails
    ? `Solo nos llega si subes la foto en este enlace:\n${deposit.paymentUrl}\n\n` +
      `Si aún no has transferido, estos son los datos:\n\n${deposit.transferDetails}`
    : `${deposit.method === "mercadopago" ? "Solo se registra si pagas" : "Solo nos llega si lo subes"} en este enlace:\n${deposit.paymentUrl}`) +
  `\n\nApenas lo hagas se valida y te confirmamos por aquí.`;

const handoffReply = (org) =>
  `Le paso tu mensaje al equipo de *${org.name.trim()}* para que te responda personalmente 🙌`;

// El modelo a veces usa Markdown que WhatsApp no interpreta (**negrita**, # títulos).
function toWhatsappFormat(text) {
  return String(text || "")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/^#{1,6}\s+/gm, "");
}

async function notifyHandoff(org, clientPhone, body) {
  const title = "Un cliente necesita respuesta 💬";
  const message = `${clientPhone} escribió al WhatsApp del negocio y el asistente no puede resolverlo: "${body.slice(0, 160)}". Respóndele desde tu WhatsApp.`;
  await Promise.allSettled([
    notificationService.createNotification({
      title,
      message,
      organizationId: org._id,
      type: "system",
      status: "unread",
    }),
    subscriptionService.sendNotificationToUser(
      org._id,
      JSON.stringify({ title, message, icon: org?.branding?.pwaIcon })
    ),
  ]);
}

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

// ── Pausas (PAUSAR del cliente o respuesta manual del negocio) ──────────────
// Fuente de verdad: colección WaBotPause (sobrevive a reinicios; TTL la borra
// al vencer). `pausedClients` es solo caché: `${orgId}:${clientPhone}` → ms.
const pausedClients = new Map();

async function getPauseUntil(orgId, clientPhone) {
  const key = `${orgId}:${clientPhone}`;
  const cached = pausedClients.get(key);
  if (cached && Date.now() < cached) return cached;
  pausedClients.delete(key);
  try {
    const pause = await WaBotPause.findOne({
      organizationId: orgId,
      clientPhone,
      until: { $gt: new Date() },
    })
      .select("until")
      .lean();
    if (!pause) return null;
    const until = pause.until.getTime();
    pausedClients.set(key, until);
    return until;
  } catch (err) {
    // Sin DB no se bloquea al cliente: mejor responder que quedarse mudo.
    console.error("[WaBookingAgent] Error leyendo pausa:", err.message);
    return null;
  }
}

// Extiende la pausa (nunca la acorta: $max) y actualiza la caché.
async function setPause(orgId, clientPhone, untilMs, reason) {
  const key = `${orgId}:${clientPhone}`;
  pausedClients.set(key, Math.max(pausedClients.get(key) || 0, untilMs));
  await WaBotPause.updateOne(
    { organizationId: orgId, clientPhone },
    { $max: { until: new Date(untilMs) }, $set: { reason } },
    { upsert: true }
  ).catch((err) => console.error("[WaBookingAgent] Error guardando pausa:", err.message));
}

async function clearPause(orgId, clientPhone) {
  pausedClients.delete(`${orgId}:${clientPhone}`);
  await WaBotPause.deleteOne({ organizationId: orgId, clientPhone }).catch((err) =>
    console.error("[WaBookingAgent] Error quitando pausa:", err.message)
  );
}

// Limpieza periódica de la caché de pausas vencidas.
setInterval(() => {
  const now = Date.now();
  for (const [key, until] of pausedClients.entries()) {
    if (now >= until) pausedClients.delete(key);
  }
}, PAUSE_TTL_MS).unref();

// ── Pausa automática cuando el negocio contesta a mano ──────────────────────
// En coexistencia, lo que el negocio escribe desde la app de WhatsApp Business
// llega como webhook smb_message_echoes (waAgentController). Si una persona ya
// está atendiendo a ese cliente, el bot se calla para no pisarle la conversación.
// Se extiende con cada respuesta manual; el cliente puede reactivarlo con AGENDAR.
// La duración la elige cada negocio (Organization.waHumanTakeoverHours, 2 h por
// defecto). Eran 12 h fijas: si el negocio contestaba algo en la mañana, el bot
// ignoraba al cliente el resto del día ("a veces contesta y a veces no").
const DEFAULT_HUMAN_TAKEOVER_HOURS = 2;

// Ids de los mensajes que envió el propio bot (Cloud API) — por si Meta llegara
// a reportarlos como eco, nunca se confunden con una respuesta del negocio.
const botMessageIds = new Map(); // id → timestamp
const BOT_MESSAGE_ID_TTL_MS = 60 * 60 * 1000;

function rememberBotMessage(id) {
  if (!id) return;
  const now = Date.now();
  if (botMessageIds.size > 2000) {
    for (const [k, ts] of botMessageIds.entries()) {
      if (now - ts > BOT_MESSAGE_ID_TTL_MS) botMessageIds.delete(k);
    }
  }
  botMessageIds.set(id, now);
}

/**
 * El negocio le respondió a mano a un cliente (eco de la app de WhatsApp
 * Business): pausa el bot para ese cliente. Devuelve false si el eco era de un
 * mensaje del propio bot.
 */
export async function pauseForHumanTakeover(orgId, clientPhone, echoMessageId, hours) {
  if (echoMessageId && botMessageIds.has(echoMessageId)) return false;
  const h = Number(hours) > 0 ? Number(hours) : DEFAULT_HUMAN_TAKEOVER_HOURS;
  const untilMs = Date.now() + h * 60 * 60 * 1000;
  try {
    // Un PAUSAR del cliente más largo se respeta. Una pausa "human" anterior se
    // reemplaza (no $max): si el negocio acortó la duración, no debe seguir la vieja.
    const existing = await WaBotPause.findOne({ organizationId: orgId, clientPhone })
      .select("until reason")
      .lean();
    if (existing?.reason === "client" && existing.until?.getTime() > untilMs) return true;
    pausedClients.set(`${orgId}:${clientPhone}`, untilMs);
    await WaBotPause.updateOne(
      { organizationId: orgId, clientPhone },
      { $set: { until: new Date(untilMs), reason: "human" } },
      { upsert: true }
    );
  } catch (err) {
    console.error("[WaBookingAgent] Error guardando pausa:", err.message);
  }
  return true;
}

// ── Sesiones ─────────────────────────────────────────────────────────────────
// Caché en memoria: `${orgId}:${clientPhone}` →
// { messages, lastActivity, sessionId, pendingPayload, pendingSummary,
//   pendingSummaryShown, pendingDeposit, reservationCreated,
//   hasConfirmedBookingThisSession, handoffReplied, lastHandoffAt }
// pendingSummary* y pendingDeposit los manejan prepare_reservation / confirm_reservation
// (booking-chatbot/tools/reservation.js): resumen oficial mostrado y abono por pagar.
// Cada turno se guarda en ChatLog (mensajes + waState); si la sesión no está en
// memoria (reinicio del servidor) se reconstruye desde ahí.
const sessions = new Map();

// Estado de la sesión que sobrevive a un reinicio (reservationCreated no: es
// one-shot y se consume en el mismo turno).
const PERSISTED_STATE_FIELDS = [
  "pendingPayload",
  "pendingSummary",
  "pendingSummaryShown",
  "pendingDeposit",
  "hasConfirmedBookingThisSession",
  "handoffReplied",
  "lastHandoffAt",
  // Acciones verificadas de la conversación (booking-chatbot/actionLog.js)
  "actionLog",
];

function snapshotState(session) {
  const state = {};
  for (const f of PERSISTED_STATE_FIELDS) {
    if (session[f] !== undefined) state[f] = session[f];
  }
  return state;
}

function newSession(now) {
  return {
    messages: [],
    lastActivity: now,
    sessionId: randomUUID(),
    pendingPayload: null,
    reservationCreated: false,
    // A diferencia de reservationCreated (one-shot, se resetea tras loguear
    // cada turno), este flag persiste toda la sesión: le indica al prompt
    // que ya se confirmó al menos una reserva en esta conversación, para
    // que turnos posteriores no vuelvan a intentar recolectar los mismos
    // datos en bucle si el cliente sigue chateando.
    hasConfirmedBookingThisSession: false,
  };
}

// Conversación del cliente en las últimas SESSION_TTL_MS guardada en ChatLog.
async function loadPersistedSession(orgId, clientPhone, now) {
  try {
    const log = await ChatLog.findOne({
      organizationId: orgId,
      clientPhone,
      channel: "whatsapp",
      updatedAt: { $gte: new Date(now - SESSION_TTL_MS) },
    })
      .sort({ updatedAt: -1 })
      .select("sessionId messages waState updatedAt")
      .lean();
    if (!log?.sessionId) return null;
    return {
      ...newSession(now),
      ...(log.waState || {}),
      sessionId: log.sessionId,
      messages: (log.messages || [])
        .filter((m) => m.role && typeof m.content === "string")
        .map((m) => ({ role: m.role, content: m.content }))
        .slice(-MAX_HISTORY),
      reservationCreated: false,
    };
  } catch (err) {
    console.error("[WaBookingAgent] Error recuperando la sesión de ChatLog:", err.message);
    return null;
  }
}

async function getOrCreateSession(orgId, clientPhone) {
  const key = `${orgId}:${clientPhone}`;
  const now = Date.now();
  const existing = sessions.get(key);
  if (existing && now - existing.lastActivity <= SESSION_TTL_MS) {
    existing.lastActivity = now;
    return existing;
  }
  sessions.delete(key);

  const restored = existing ? null : await loadPersistedSession(orgId, clientPhone, now);
  if (restored) {
    console.log(`[WaBookingAgent] Sesión recuperada de ChatLog — ${clientPhone} (${restored.messages.length} mensajes)`);
  }
  const session = restored || newSession(now);
  session.lastActivity = now;
  sessions.set(key, session);
  return session;
}

// ── Fotos y notas de voz ─────────────────────────────────────────────────────
// Claude ve las fotos directamente; las notas de voz se transcriben con OpenAI
// (Claude no acepta audio). En el historial quedan como texto marcado
// ("🎤 (nota de voz) …", "📷 (imagen) …") — ver la sección del prompt.
const VOICE_FAIL_REPLY = "No pude escuchar tu nota de voz 🙏 ¿Me lo escribes por aquí?";
// Límite de Claude por imagen: 5 MB.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const CLAUDE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

async function resolveIncomingMedia(org, media, caption) {
  const text = String(caption || "").trim();
  if (!media?.id) return { body: text, historyText: text };

  if (media.type === "audio") {
    try {
      const { buffer, mimeType } = await downloadMedia(org, media.id, MAX_AUDIO_BYTES);
      const transcript = await transcribeAudio(buffer, mimeType || media.mimeType);
      if (transcript) return { body: transcript, historyText: `🎤 (nota de voz) ${transcript}` };
    } catch (err) {
      console.error("[WaBookingAgent] Error descargando nota de voz:", err.message);
    }
    return { body: "", historyText: "🎤 (nota de voz — no se pudo transcribir)", failReply: VOICE_FAIL_REPLY };
  }

  // Imagen
  const label = `📷 (imagen)${text ? ` ${text}` : ""}`;
  try {
    const { buffer, mimeType } = await downloadMedia(org, media.id, MAX_IMAGE_BYTES);
    const type = mimeType || media.mimeType;
    if (CLAUDE_IMAGE_TYPES.has(type)) {
      return { body: text, historyText: label, images: [{ mediaType: type, data: buffer.toString("base64") }] };
    }
    console.warn(`[WaBookingAgent] Formato de imagen no soportado: ${type}`);
  } catch (err) {
    console.error("[WaBookingAgent] Error descargando imagen:", err.message);
  }
  // Sin la imagen el modelo solo sabe que llegó una foto (y su pie, si tiene).
  return { body: text, historyText: `📷 (imagen — no se pudo ver)${text ? ` ${text}` : ""}` };
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
 * @param {string} body        - Texto del mensaje (pie de foto si es imagen; vacío si es audio)
 * @param {Object} [opts]
 * @param {{type: "image"|"audio", id: string, mimeType?: string}} [opts.media] - foto o nota de voz
 */
export async function processClientBookingMessage(org, clientPhone, body, opts = {}) {
  const orgId = org._id.toString();
  const startedAt = Date.now();

  const normalized = normalizeCommand(body);
  const isPauseCommand = PAUSE_COMMANDS.has(normalized);
  const isResumeCommand = RESUME_COMMANDS.has(normalized);
  const pausedUntil = await getPauseUntil(orgId, clientPhone);

  // El cliente pausó el bot explícitamente — no lo interrumpimos ni gastamos IA,
  // salvo que este mensaje sea justo el comando de reactivación.
  if (pausedUntil && !isResumeCommand) {
    console.log(
      `[WaBookingAgent] Ignorado (pausado hasta ${new Date(pausedUntil).toISOString()}) — ${clientPhone}`
    );
    return;
  }
  if (isResumeCommand && pausedUntil) {
    await clearPause(orgId, clientPhone);
  }

  // Foto o nota de voz: se resuelve después de la pausa (no se gasta en clientes
  // que el negocio atiende a mano). historyText es lo que queda en el historial.
  const media = await resolveIncomingMedia(org, opts.media, body);
  body = media.body;
  const historyText = media.historyText;

  console.log(
    `[WaBookingAgent] Mensaje de cliente — org: ${org.name} — ${clientPhone} — "${historyText.slice(0, 80)}"`
  );

  const session = await getOrCreateSession(orgId, clientPhone);
  const isFirstMessageInSession = session.messages.length === 0;
  session.messages.push({ role: "user", content: historyText });

  let reply;
  let meta = {};
  let errorMsg = null;
  let noReply = false;
  let handoff = false;

  if (isPauseCommand) {
    // Comando de pausa: respuesta fija (no depende del modelo) para garantizar
    // el texto exacto, y sin invocar al asistente en absoluto.
    reply = PAUSE_ACK_MESSAGE;
    await setPause(orgId, clientPhone, Date.now() + PAUSE_TTL_MS, "client");
  } else if (media.failReply) {
    // Nota de voz que no se pudo transcribir: respuesta fija en vez de silencio.
    reply = media.failReply;
  } else {
    // Estado real del abono pendiente (sin pagar / en revisión / pagado /
    // rechazado / vencido): el bot responde desde aquí en vez de suponerlo.
    if (session.pendingDeposit?.externalReference) {
      try {
        const order = await Order.findOne({ externalReference: session.pendingDeposit.externalReference })
          .select("status")
          .lean();
        if (order) session.pendingDeposit.status = order.status;
      } catch (err) {
        console.warn("[WaBookingAgent] No se pudo leer el estado del abono:", err.message);
      }
    }
    const deposit = session.pendingDeposit;
    const depositOpen = deposit && ["created", "pending"].includes(deposit.status);
    if (depositOpen && ASKS_PAYMENT_DETAILS_PATTERN.test(body)) {
      reply = depositPayText(deposit);
    } else if (depositOpen && PAYMENT_CLAIM_PATTERN.test(body)) {
      // Dice que ya pagó pero el sistema no tiene nada: respuesta fija. El modelo
      // inventaba "se está procesando, en unos minutos te llega la confirmación"
      // y el cliente se quedaba esperando algo que nunca iba a llegar.
      reply = notPaidYetReply(deposit);
    } else try {
      const result = await processBookingChat(org, session.messages, {
        channel: "whatsapp",
        session,
        sessionId: session.sessionId,
        clientPhone,
        actionLog: session.actionLog,
        images: media.images,
      });
      noReply = result.noReply === true;
      handoff = result.handoff === true;
      meta = result._meta || {};
      if (meta.actions?.length) {
        session.actionLog = [...(session.actionLog || []), ...meta.actions].slice(-MAX_ACTION_LOG);
      }
      if (handoff) {
        // Necesita a una persona: se le avisa al cliente una vez por conversación
        // (los mensajes siguientes ya los ve el negocio) y se notifica al negocio.
        const recentlyNotified =
          session.lastHandoffAt && Date.now() - session.lastHandoffAt < HANDOFF_NOTIFY_COOLDOWN_MS;
        if (!recentlyNotified) {
          session.lastHandoffAt = Date.now();
          notifyHandoff(org, clientPhone, body).catch((err) =>
            console.error("[WaBookingAgent] Error notificando handoff:", err.message)
          );
        }
        noReply = !!session.handoffReplied;
        reply = noReply ? HANDOFF_NOTE : handoffReply(org);
        session.handoffReplied = true;
      } else {
        reply = noReply ? NO_REPLY_NOTE : toWhatsappFormat(result.reply || "¿En qué puedo ayudarte con tu reserva?");
      }
    } catch (err) {
      console.error("[WaBookingAgent] Error en processBookingChat:", err);
      errorMsg = err.message;
      reply =
        "Lo siento, tuve un problema procesando tu mensaje. Intenta de nuevo en un momento.";
    }

    // Primer mensaje de la sesión: informar del comando de pausa junto al saludo.
    if (isFirstMessageInSession && !noReply && !handoff && reply) {
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
      const sent = await whatsappService.sendMessage(orgId, clientPhone, reply);
      rememberBotMessage(sent?.messageId);
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
      clientPhone,
      "review.reviewed": false,
    },
    // Un solo $push con ambos campos: antes el de toolErrors (spread más abajo)
    // reemplazaba este y el turno quedaba sin mensajes en el ChatLog.
    $push: {
      messages: {
        $each: [
          { role: "user", content: historyText },
          { role: "assistant", content: reply },
        ],
      },
      ...(meta.toolErrors?.length ? { toolErrors: { $each: meta.toolErrors, $slice: -50 } } : {}),
    },
    $set: {
      reply,
      durationMs: Date.now() - startedAt,
      // Estado de la reserva en curso, para retomar la conversación si el
      // servidor se reinicia (ver loadPersistedSession).
      waState: snapshotState(session),
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
      cacheReadTokens: meta.cacheReadTokens || 0,
      cacheWriteTokens: meta.cacheWriteTokens || 0,
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
