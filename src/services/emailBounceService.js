import { ImapFlow } from "imapflow";
import Organization from "../models/organizationModel.js";
import notificationService from "./notificationService.js";
import { looksLikeBounce, parseBounce } from "../utils/bounceParser.js";

// Lee los avisos de no entrega que llegan al buzón hola@agenditapp.com (el
// mismo desde el que salen los correos, MAIL_FROM) y marca el correo del dueño
// como inválido en Organization.ownerEmailBounce. Así la recuperación de acceso
// ofrece solo WhatsApp y el dueño ve en su panel que debe corregir el correo.
//
// Solo lee: no mueve, no borra y no marca como leídos los correos (imapflow
// descarga con BODY.PEEK). Mira los últimos LOOKBACK_DAYS días en cada
// corrida; la actualización es idempotente.
//
// Variables: IMAP_HOST (default imap.hostinger.com), IMAP_PORT (993), y las
// credenciales de SMTP_USER / SMTP_PASS (es el mismo buzón).

const LOOKBACK_DAYS = 3;
const MAX_MESSAGES = 300;

export function isBounceCheckConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * @returns {Promise<{ scanned: number, bounces: number, marked: number, skipped?: string }>}
 */
export async function checkEmailBounces() {
  if (!isBounceCheckConfigured()) return { scanned: 0, bounces: 0, marked: 0, skipped: "not_configured" };

  const client = new ImapFlow({
    host: process.env.IMAP_HOST || "imap.hostinger.com",
    port: Number(process.env.IMAP_PORT) || 993,
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    logger: false,
    socketTimeout: 60_000,
  });

  const bounces = [];
  let scanned = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const uids = (await client.search({ since }, { uid: true })) || [];
      const recent = uids.slice(-MAX_MESSAGES);
      if (recent.length) {
        // 1) Solo encabezados para filtrar los avisos de no entrega.
        const candidates = [];
        for await (const msg of client.fetch(recent, { uid: true, envelope: true, internalDate: true }, { uid: true })) {
          scanned++;
          const from = (msg.envelope?.from || []).map((a) => `${a.name || ""} <${a.address || ""}>`).join(", ");
          if (looksLikeBounce({ from, subject: msg.envelope?.subject })) {
            candidates.push({ uid: msg.uid, date: msg.internalDate || msg.envelope?.date || new Date() });
          }
        }
        // 2) Fuente completa solo de esos.
        for (const { uid, date } of candidates) {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!msg?.source) continue;
          for (const b of parseBounce(msg.source.toString("utf8"))) {
            if (b.permanent) bounces.push({ ...b, date: new Date(date) });
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  let marked = 0;
  for (const b of bounces) {
    marked += await markBounced(b);
  }
  return { scanned, bounces: bounces.length, marked };
}

/** Marca los negocios cuyo dueño tiene ese correo (solo si no estaba ya marcado). */
async function markBounced({ recipient, status, diagnostic, date }) {
  const orgs = await Organization.find({
    email: recipient,
    "ownerEmailBounce.address": { $ne: recipient },
  })
    .select("_id name slug")
    .lean();

  let marked = 0;
  for (const org of orgs) {
    const res = await Organization.updateOne(
      { _id: org._id, email: recipient, "ownerEmailBounce.address": { $ne: recipient } },
      {
        $set: {
          ownerEmailBounce: { address: recipient, bouncedAt: date, status: status || null, reason: diagnostic || null },
        },
      }
    );
    if (!res.modifiedCount) continue;
    marked++;
    console.log(`📭 [emailBounce] ${org.slug || org._id}: ${recipient} rebotó (${status || "sin código"})`);
    notificationService
      .createNotification({
        title: "Tu correo no está recibiendo mensajes",
        message: `Los correos que enviamos a ${recipient} no llegan. Revisa que esté bien escrito y actualízalo en Mi negocio para no perder avisos importantes ni la opción de recuperar tu cuenta por correo.`,
        organizationId: org._id,
        type: "system",
        frontendRoute: "/informacion-negocio",
        status: "unread",
      })
      .catch((err) => console.error("[emailBounce] Notificación:", err?.message || err));
  }
  return marked;
}
