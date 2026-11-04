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
import { describeOrder, formatOrderAmount } from "./orderSummary.js";

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
/** In-app + push al admin (no se interrumpen entre sí). */
async function sendInAppAndPush(org, { title, message, frontendRoute }) {
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
}

export async function notifyAdminReceipt({ org, order, autoApproved, fulfillError }) {
  const label = TYPE_LABEL[order.type] || "pago";
  const amount = formatOrderAmount(order);

  // Quién pagó y qué pagó (reserva/clase/paquete/pedido vinculado). Si el Order
  // no tiene cliente resoluble, se usa el titular que la IA leyó del comprobante.
  const sender = order.receipt?.extracted?.senderName?.trim() || null;
  const ref = order.receipt?.extracted?.reference;
  const { customerName, concept } = await describeOrder(order, org);
  const payer = customerName || sender;

  // fulfillError: el comprobante es válido pero la reserva no se pudo confirmar
  // (ej. el profesional ya tiene otra cita) — hay que resolverla en Gestionar reservas.
  const title = autoApproved
    ? "Pago confirmado ✅"
    : fulfillError
    ? "Pago recibido, reserva sin confirmar ⚠️"
    : "Comprobante por revisar 🧾";
  const message = autoApproved
    ? `${payer || "Un cliente"} pagó ${concept} por ${amount}. Validado automáticamente.`
    : fulfillError
    ? `El comprobante de ${payer || "un cliente"} por ${concept} (${amount}) es válido, pero no se pudo confirmar la reserva: ${fulfillError}. Cambia el profesional u horario en Gestionar reservas y apruébala junto con el pago.`
    : `${payer || "Un cliente"} envió un comprobante por ${concept} (${amount}). Requiere tu revisión.`;

  // Ruta del panel admin (lista de comprobantes / agenda / reservas).
  const frontendRoute = autoApproved
    ? "/gestionar-agenda"
    : fulfillError && order.type === "reservation"
    ? "/gestionar-reservas-online"
    : "/gestionar-pagos";

  // 1) In-app + 2) Push.
  await sendInAppAndPush(org, { title, message, frontendRoute });

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

    const detalle = [
      customerName ? `Cliente: ${customerName}` : null,
      concept,
      // El titular de la cuenta solo aporta si es otra persona.
      sender && sender.toLowerCase() !== customerName?.toLowerCase() ? `De: ${sender}` : null,
      ref ? `Ref: ${ref}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "—";
    const estado = autoApproved
      ? "Validado automáticamente con IA ✅"
      : fulfillError
      ? `Pago válido, pero la reserva no se confirmó (${fulfillError}). Resuélvelo en panel → Gestionar reservas ⚠️`
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
        payer ? `Cliente: ${payer}` : null,
        `Concepto: ${concept}`,
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

// Pantalla del admin donde se ve lo que se acaba de pagar por Mercado Pago.
const MP_ROUTE_BY_TYPE = {
  reservation: "/gestionar-agenda",
  class: "/gestionar-clases",
  package: "/gestionar-paquetes",
};

/**
 * Pago confirmado por Mercado Pago (reserva / clase / paquete). Antes no se
 * avisaba al admin; los pedidos de tienda ya tienen su propio aviso
 * (storeNotifier.notifyNewStoreOrder), así que aquí se omiten.
 * Solo in-app + push.
 */
export async function notifyAdminOnlinePayment({ org, order }) {
  if (!org || !order || order.type === "store") return;
  const { customerName, concept } = await describeOrder(order, org);
  await sendInAppAndPush(org, {
    title: "Pago confirmado ✅",
    message: `${customerName || "Un cliente"} pagó ${concept} por ${formatOrderAmount(order)} con Mercado Pago.`,
    frontendRoute: MP_ROUTE_BY_TYPE[order.type] || "/gestionar-agenda",
  });
}

export default { notifyAdminReceipt, notifyAdminOnlinePayment };
