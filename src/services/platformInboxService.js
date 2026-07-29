import PlatformWaMessage from "../models/platformWaMessageModel.js";
import Organization from "../models/organizationModel.js";
import { sendTextMessage } from "./metaApiService.js";

const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/** Busca la org dueña de un teléfono, sin filtrar por waAgentEnabled (a diferencia
 * del routing del webhook) — se usa solo para etiquetar el mensaje en el inbox. */
export async function findOrganizationByPhone(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  return Organization.findOne({
    $or: [
      { phoneNumber: { $in: [digits, `+${digits}`] } },
      { waPhone: { $in: [digits, `+${digits}`] } },
    ],
  }).lean();
}

export async function logInboundMessage({ phone, organizationId, body, metaMessageId }) {
  return PlatformWaMessage.create({
    phone: normalizePhone(phone),
    organizationId: organizationId || null,
    direction: "inbound",
    source: "inbound",
    body,
    metaMessageId: metaMessageId || null,
  });
}

export async function logOutboundMessage({ phone, organizationId, body, source, templateName, repliedByAdminId }) {
  return PlatformWaMessage.create({
    phone: normalizePhone(phone),
    organizationId: organizationId || null,
    direction: "outbound",
    source,
    body,
    templateName: templateName || null,
    repliedByAdminId: repliedByAdminId || null,
  });
}

/** Lista conversaciones (agrupadas por teléfono) ordenadas por última actividad. */
export async function listConversations() {
  const rows = await PlatformWaMessage.aggregate([
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
    { $match: { direction: "inbound", read: false } },
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

export async function getConversationMessages(phone) {
  const cleanPhone = normalizePhone(phone);
  return PlatformWaMessage.find({ phone: cleanPhone }).sort({ createdAt: 1 }).lean();
}

export async function markConversationRead(phone) {
  const cleanPhone = normalizePhone(phone);
  await PlatformWaMessage.updateMany(
    { phone: cleanPhone, direction: "inbound", read: false },
    { $set: { read: true } }
  );
}

export async function replyToConversation({ phone, body, adminId }) {
  const cleanPhone = normalizePhone(phone);

  // Reusa la org ya vinculada a este hilo (evita repetir el matching por teléfono).
  const lastLinked = await PlatformWaMessage.findOne({ phone: cleanPhone, organizationId: { $ne: null } })
    .sort({ createdAt: -1 })
    .select("organizationId")
    .lean();

  await sendTextMessage(`+${cleanPhone}`, body);

  return logOutboundMessage({
    phone: cleanPhone,
    organizationId: lastLinked?.organizationId || null,
    body,
    source: "manual",
    repliedByAdminId: adminId || null,
  });
}
