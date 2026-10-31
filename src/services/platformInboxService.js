import PlatformWaMessage from "../models/platformWaMessageModel.js";
import Organization from "../models/organizationModel.js";
import { sendTextMessage, markMessageAsRead } from "./metaApiService.js";

const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

// Línea = número de AgenditApp ("platform", el oficial, u "oficina"). Los mensajes
// guardados antes de existir el campo no lo tienen y son del oficial.
export function normalizeLine(line) {
  return line === "oficina" ? "oficina" : "platform";
}

export function lineFilter(line) {
  return normalizeLine(line) === "oficina" ? { line: "oficina" } : { line: { $ne: "oficina" } };
}

export function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/** Filtro de organizaciones por teléfono (guardado con o sin "+"). Un dueño puede
 * tener varios negocios con el mismo número. */
export function organizationPhoneFilter(phone) {
  const digits = normalizePhone(phone);
  return {
    $or: [
      { phoneNumber: { $in: [digits, `+${digits}`] } },
      { waPhone: { $in: [digits, `+${digits}`] } },
    ],
  };
}

/** Busca la org dueña de un teléfono, sin filtrar por waAgentEnabled (a diferencia
 * del routing del webhook) — se usa solo para etiquetar el mensaje en el inbox.
 * Si varias comparten el teléfono, devuelve una cualquiera. */
export async function findOrganizationByPhone(phone) {
  if (!normalizePhone(phone)) return null;
  return Organization.findOne(organizationPhoneFilter(phone)).lean();
}

export async function logInboundMessage({ phone, organizationId, body, metaMessageId, line }) {
  return PlatformWaMessage.create({
    phone: normalizePhone(phone),
    organizationId: organizationId || null,
    line: normalizeLine(line),
    direction: "inbound",
    source: "inbound",
    body,
    metaMessageId: metaMessageId || null,
  });
}

export async function logOutboundMessage({ phone, organizationId, body, source, templateName, repliedByAdminId, metaMessageId, line }) {
  return PlatformWaMessage.create({
    phone: normalizePhone(phone),
    organizationId: organizationId || null,
    line: normalizeLine(line),
    direction: "outbound",
    source,
    body,
    templateName: templateName || null,
    repliedByAdminId: repliedByAdminId || null,
    metaMessageId: metaMessageId || null,
  });
}

// Orden de progreso de los ticks de WhatsApp — usado para no pisar un status más
// avanzado si un webhook llega tarde o fuera de orden (Meta no garantiza el orden).
const STATUS_RANK = { failed: 1, sent: 1, delivered: 2, read: 3 };

/** Actualiza el status (ticks) de un mensaje saliente a partir del webhook de Meta.
 * No hace nada si el metaMessageId no corresponde a ningún mensaje logueado
 * (ej. mensajes de un número Meta de una org, que no pasan por este inbox). */
export async function updateMessageStatus({ metaMessageId, status, error }) {
  if (!metaMessageId || !STATUS_RANK[status]) return;

  // La condición va en el mismo updateOne: un webhook trae varios estados que se
  // procesan a la vez, y leer antes de escribir dejaba que "delivered" pisara a "read".
  const notAhead = Object.keys(STATUS_RANK).filter((s) => STATUS_RANK[s] <= STATUS_RANK[status]);
  const failed = status === "failed";
  await PlatformWaMessage.updateOne(
    { metaMessageId, status: { $in: [null, ...notAhead] } },
    {
      $set: {
        status,
        statusUpdatedAt: new Date(),
        errorCode: failed && Number.isInteger(error?.code) ? error.code : null,
        errorTitle: failed && error?.title ? String(error.title).slice(0, 300) : null,
      },
    }
  );
}

/** Lista las conversaciones de un número (agrupadas por teléfono) ordenadas por última actividad. */
export async function listConversations(line) {
  const rows = await PlatformWaMessage.aggregate([
    { $match: lineFilter(line) },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$phone",
        organizationId: { $first: "$organizationId" },
        lastMessage: { $first: "$body" },
        lastDirection: { $first: "$direction" },
        lastSource: { $first: "$source" },
        lastMessageAt: { $first: "$createdAt" },
        lastInboundAt: {
          $max: { $cond: [{ $eq: ["$direction", "inbound"] }, "$createdAt", null] },
        },
      },
    },
    {
      $lookup: {
        from: "organizations",
        localField: "organizationId",
        foreignField: "_id",
        as: "org",
      },
    },
    { $unwind: { path: "$org", preserveNullAndEmptyArrays: true } },
    { $sort: { lastMessageAt: -1 } },
  ]);

  const unreadRows = await PlatformWaMessage.aggregate([
    { $match: { ...lineFilter(line), direction: "inbound", read: false } },
    { $group: { _id: "$phone", count: { $sum: 1 } } },
  ]);
  const unreadMap = new Map(unreadRows.map((r) => [r._id, r.count]));

  return rows.map((r) => ({
    phone: r._id,
    organization: r.org
      ? { _id: r.org._id, name: r.org.name, slug: r.org.slug, ownerName: r.org.ownerName }
      : null,
    lastMessage: r.lastMessage,
    lastDirection: r.lastDirection,
    lastSource: r.lastSource,
    lastMessageAt: r.lastMessageAt,
    unreadCount: unreadMap.get(r._id) || 0,
    withinReplyWindow: r.lastInboundAt
      ? Date.now() - new Date(r.lastInboundAt).getTime() < REPLY_WINDOW_MS
      : false,
  }));
}

export async function getConversationMessages(phone, line) {
  const cleanPhone = normalizePhone(phone);
  return PlatformWaMessage.find({ phone: cleanPhone, ...lineFilter(line) }).sort({ createdAt: 1 }).lean();
}

/** Marca leídos en nuestro inbox Y le confirma a Meta que se leyeron (para que el
 * cliente vea su propio check azul) — recién ahora, cuando un humano de verdad
 * abre la conversación, no antes. */
export async function markConversationRead(phone, line) {
  const cleanPhone = normalizePhone(phone);
  const filter = { phone: cleanPhone, ...lineFilter(line), direction: "inbound", read: false };

  const unread = await PlatformWaMessage.find(filter).select("metaMessageId");

  for (const msg of unread) {
    if (!msg.metaMessageId) continue;
    markMessageAsRead(msg.metaMessageId, normalizeLine(line)).catch((err) =>
      console.error("[platformInbox] Error marcando como leído en Meta:", err.response?.data || err.message)
    );
  }

  await PlatformWaMessage.updateMany(filter, { $set: { read: true } });
}

/** Responde con texto libre desde el mismo número de la conversación. */
export async function replyToConversation({ phone, body, adminId, line }) {
  const cleanPhone = normalizePhone(phone);
  const waLine = normalizeLine(line);

  // Reusa la org ya vinculada a este hilo (evita repetir el matching por teléfono).
  const lastLinked = await PlatformWaMessage.findOne({ phone: cleanPhone, organizationId: { $ne: null } })
    .sort({ createdAt: -1 })
    .select("organizationId")
    .lean();

  const { messageId } = await sendTextMessage(`+${cleanPhone}`, body, waLine);

  return logOutboundMessage({
    phone: cleanPhone,
    organizationId: lastLinked?.organizationId || null,
    body,
    source: "manual",
    repliedByAdminId: adminId || null,
    metaMessageId: messageId,
    line: waLine,
  });
}
