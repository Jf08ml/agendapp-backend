/**
 * adminPaymentNotifier.js
 *
 * Notifica al admin cuando llega un comprobante de pago (provider "receipt"):
 *  - Push web (VAPID) — mismo patrón que las reservas (userId = org._id).
 *  - Notificación in-app (modelo Notification).
 *  - WhatsApp por el número de AgenditApp (el mismo canal del asistente admin).
 *
 * Best-effort: ningún fallo de notificación debe romper el flujo de pago.
 */

import notificationService from "../notificationService.js";
import subscriptionService from "../subscriptionService.js";
import { sendTextMessage } from "../metaApiService.js";

/** Normaliza el teléfono del admin a E.164 (mismo criterio que waAgentChatService). */
function normalizeAdminPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("57") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+57${digits}`;
  return `+${digits}`;
}

const TYPE_LABEL = {
  reservation: "reserva",
  class: "clase",
  package: "paquete",
  store: "pedido de tienda",
};

/**
 * @param {Object} p
 * @param {Object} p.org        Organization (necesita _id, name, phoneNumber, branding, currency)
 * @param {Object} p.order      Order con el comprobante
 * @param {boolean} p.autoApproved  true si la IA confirmó sola; false si requiere revisión
 */
export async function notifyAdminReceipt({ org, order, autoApproved }) {
  const label = TYPE_LABEL[order.type] || "pago";
  const amount = `${order.amount} ${order.currency || ""}`.trim();

  const title = autoApproved
    ? "Pago confirmado ✅"
    : "Comprobante por revisar 🧾";
  const message = autoApproved
    ? `Se confirmó automáticamente un pago de ${label} por ${amount}.`
    : `Recibiste un comprobante de ${label} por ${amount} que requiere tu revisión.`;

  // Ruta del panel admin (lista de comprobantes / agenda).
  const frontendRoute = autoApproved ? "/gestionar-agenda" : "/gestionar-pagos";

  // 1) In-app + 2) Push (no se interrumpen entre sí).
  await Promise.allSettled([
    notificationService.createNotification({
      title,
      message,
      organizationId: org._id,
      type: "payment",
      frontendRoute,
      status: "unread",
    }),
    subscriptionService.sendNotificationToUser(
      org._id,
      JSON.stringify({ title, message, icon: org?.branding?.pwaIcon })
    ),
  ]);

  // 3) WhatsApp al admin por el número de AgenditApp.
  const adminPhone = normalizeAdminPhone(org.phoneNumber);
  if (adminPhone) {
    const sender = order.receipt?.extracted?.senderName;
    const ref = order.receipt?.extracted?.reference;
    const lines = [
      autoApproved
        ? `✅ *Pago de ${label} confirmado*`
        : `🧾 *Comprobante de ${label} por revisar*`,
      `Monto: ${amount}`,
      sender ? `De: ${sender}` : null,
      ref ? `Ref: ${ref}` : null,
      autoApproved
        ? "Validado automáticamente con IA."
        : "Revísalo en tu panel: Pagos → Comprobantes.",
    ].filter(Boolean);
    try {
      await sendTextMessage(adminPhone, lines.join("\n"));
    } catch (err) {
      console.warn("[adminPaymentNotifier] WhatsApp falló:", err?.message || err);
    }
  }
}

export default { notifyAdminReceipt };
