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
import WhatsappTemplate from "../../models/whatsappTemplateModel.js";
import whatsappService from "../sendWhatsappService.js";
import { sendTextMessage, sendPlatformTemplate } from "../metaApiService.js";

/** Normaliza el teléfono del admin a E.164 (mismo criterio que waAgentChatService). */
export function normalizeAdminPhone(phone) {
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

  // 3) WhatsApp al admin — en cascada:
  //    a) Toggle enabledTypes.adminPaymentAlert === false → no se envía nada
  //       por ningún canal (push e in-app no se tocan).
  //    b) Canal de la propia org (Baileys/Meta vía sendNotification, template
  //       "adminPaymentAlert" personalizable) al teléfono del admin.
  //    c) Fallback plataforma (comportamiento anterior intacto): plantilla de
  //       utilidad "pago_recibido_admin" por el número de AgenditApp (entrega
  //       garantizada, sin ventana de 24h); si falla (p.ej. aún no aprobada
  //       por Meta), texto libre, que solo llega si el admin escribió en las
  //       últimas 24h.
  const adminPhone = normalizeAdminPhone(org.phoneNumber);
  if (adminPhone) {
    // a) Toggle: apaga el aviso de WhatsApp por completo
    try {
      const templateDoc = await WhatsappTemplate.findOne({ organizationId: org._id });
      if (templateDoc?.enabledTypes?.adminPaymentAlert === false) {
        console.log(`⏭️  [adminPaymentNotifier] Aviso deshabilitado (enabledTypes.adminPaymentAlert) para org ${org._id}`);
        return;
      }
    } catch (cfgErr) {
      console.warn("[adminPaymentNotifier] No se pudo leer enabledTypes, continuando:", cfgErr?.message || cfgErr);
    }

    const sender = order.receipt?.extracted?.senderName;
    const ref = order.receipt?.extracted?.reference;
    const detalle = [sender ? `De: ${sender}` : null, ref ? `Ref: ${ref}` : null]
      .filter(Boolean)
      .join(" · ") || "—";
    const estado = autoApproved
      ? "Validado automáticamente con IA ✅"
      : "Requiere tu revisión: panel → Comprobantes de pago 🧾";

    // b) Canal de la org (mismo ruteo Baileys/Meta del resto de notificaciones).
    // sendNotification lanza si la org no tiene sesión WA configurada, retorna
    // { blocked } si el plan no incluye WhatsApp y null si (siendo Meta) no hay
    // template aprobado ni fallback — en todos esos casos caemos a plataforma.
    let sentViaOrg = false;
    try {
      const result = await whatsappService.sendNotification(
        org._id.toString(),
        adminPhone,
        "adminPaymentAlert",
        { tipo: label, monto: amount, detalle, estado }
      );
      sentViaOrg = !!result && !result.blocked;
    } catch (orgErr) {
      console.warn(
        "[adminPaymentNotifier] Canal de la org no disponible, fallback a plataforma:",
        orgErr?.message || orgErr
      );
    }
    if (sentViaOrg) return;

    // c) Fallback plataforma (lógica original sin cambios)
    try {
      await sendPlatformTemplate(adminPhone, "pago_recibido_admin", [
        label,
        amount,
        detalle,
        estado,
      ]);
    } catch (tplErr) {
      console.warn(
        "[adminPaymentNotifier] Plantilla falló, intento texto libre:",
        tplErr.response?.data?.error?.message || tplErr?.message || tplErr
      );
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
}

export default { notifyAdminReceipt };
