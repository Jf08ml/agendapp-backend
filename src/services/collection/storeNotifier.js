/**
 * storeNotifier.js
 *
 * Notificaciones por pedidos de la TIENDA pública (Order type "store"):
 * - Al admin: notificación in-app (modelo Notification) + push web (VAPID,
 *   userId = org._id). Copia el patrón de notifyNewBooking (reservationController.js).
 * - Al comprador: WhatsApp "Pago recibido" (template `paymentReceived`,
 *   Baileys/Meta vía whatsappService.sendNotification — mismo ruteo que el
 *   cron de cumpleaños).
 *
 * Best-effort: ningún fallo de notificación debe romper el flujo de pago.
 */

import notificationService from "../notificationService.js";
import subscriptionService from "../subscriptionService.js";
import WhatsappTemplate from "../../models/whatsappTemplateModel.js";
import whatsappService from "../sendWhatsappService.js";
import { sendPlatformTemplate } from "../metaApiService.js";
import { normalizeAdminPhone } from "./adminPaymentNotifier.js";

/** Resumen corto de los items para el cuerpo de la notificación. */
function summarizeItems(order) {
  const items = order?.store?.items || [];
  const units = items.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
  return `${units} producto${units === 1 ? "" : "s"}`;
}

/**
 * Pedido nuevo (pagado online o contraentrega). in-app type "payment",
 * frontendRoute "/pedidos" + push.
 */
export async function notifyNewStoreOrder({ org, order }) {
  const customerName = order?.store?.customer?.name || "un cliente";
  const amount = `${order.amount} ${order.currency || ""}`.trim();
  const isCod = order.provider === "cod";

  const title = isCod ? "Nuevo pedido (contraentrega) 🛍️" : "Nuevo pedido pagado 🛍️";
  const message = isCod
    ? `${customerName} hizo un pedido de ${summarizeItems(order)} por ${amount}. Se cobra al entregar.`
    : `${customerName} pagó un pedido de ${summarizeItems(order)} por ${amount}.`;

  try {
    await Promise.allSettled([
      notificationService.createNotification({
        title,
        message,
        organizationId: org._id,
        type: "payment",
        frontendRoute: "/pedidos",
        status: "unread",
      }),
      subscriptionService.sendNotificationToUser(
        org._id,
        JSON.stringify({ title, message, icon: org?.branding?.pwaIcon })
      ),
    ]);
  } catch (e) {
    console.warn("[notifyNewStoreOrder] Error enviando notificaciones:", e?.message || e);
  }

  // WhatsApp al admin — en cascada:
  //  a) Toggle enabledTypes.adminNewOrderAlert === false → no se envía nada
  //     por ningún canal (push e in-app no se tocan).
  //  b) Canal de la propia org (Baileys/Meta vía sendNotification, template
  //     "adminNewOrderAlert" personalizable) al teléfono del admin.
  //  c) Fallback plataforma (comportamiento anterior intacto): plantilla de
  //     utilidad "pedido_nuevo_admin" por el número de AgenditApp; sin
  //     fallback de texto — antes no existía este canal.
  const adminPhone = normalizeAdminPhone(org.phoneNumber);
  if (adminPhone) {
    // a) Toggle: apaga el aviso de WhatsApp por completo
    try {
      const templateDoc = await WhatsappTemplate.findOne({ organizationId: org._id });
      if (templateDoc?.enabledTypes?.adminNewOrderAlert === false) {
        console.log(`⏭️  [notifyNewStoreOrder] Aviso deshabilitado (enabledTypes.adminNewOrderAlert) para org ${org._id}`);
        return;
      }
    } catch (cfgErr) {
      console.warn("[notifyNewStoreOrder] No se pudo leer enabledTypes, continuando:", cfgErr?.message || cfgErr);
    }

    const delivery = order?.store?.delivery;
    const entrega =
      delivery?.mode === "delivery"
        ? `Domicilio: ${delivery?.address || "sin dirección"}`
        : "Retiro en el local";
    const pago = isCod ? "Contraentrega — por cobrar 💵" : "Pagado ✅";
    const pedido = `${summarizeItems(order)} · ${amount}`;

    // b) Canal de la org (mismo ruteo Baileys/Meta del resto de notificaciones).
    // sendNotification lanza si la org no tiene sesión WA configurada, retorna
    // { blocked } si el plan no incluye WhatsApp y null si (siendo Meta) no hay
    // template aprobado ni fallback — en todos esos casos caemos a plataforma.
    let sentViaOrg = false;
    try {
      const result = await whatsappService.sendNotification(
        org._id.toString(),
        adminPhone,
        "adminNewOrderAlert",
        { cliente: customerName, pedido, entrega, pago }
      );
      sentViaOrg = !!result && !result.blocked;
    } catch (orgErr) {
      console.warn(
        "[notifyNewStoreOrder] Canal de la org no disponible, fallback a plataforma:",
        orgErr?.message || orgErr
      );
    }

    // c) Fallback plataforma (lógica original sin cambios)
    if (!sentViaOrg) {
      try {
        await sendPlatformTemplate(adminPhone, "pedido_nuevo_admin", [
          customerName,
          pedido,
          entrega,
          pago,
        ]);
      } catch (err) {
        console.warn(
          "[notifyNewStoreOrder] WhatsApp admin falló:",
          err.response?.data?.error?.message || err?.message || err
        );
      }
    }
  }
}

/**
 * Conflicto de stock al cumplir un pedido YA PAGADO (decisión 2 del plan): el
 * pago no se revierte; el admin debe resolver manualmente (reponer/contactar).
 */
export async function notifyStoreStockConflict({ org, order, reason }) {
  const customerName = order?.store?.customer?.name || "un cliente";
  const amount = `${order.amount} ${order.currency || ""}`.trim();

  const title = "Pedido pagado con conflicto de stock ⚠️";
  const message = `${customerName} pagó un pedido por ${amount}, pero no se pudo registrar la venta: ${
    reason || "stock insuficiente"
  }. Revísalo en Pedidos.`;

  try {
    await Promise.allSettled([
      notificationService.createNotification({
        title,
        message,
        organizationId: org._id,
        type: "payment",
        frontendRoute: "/pedidos",
        status: "unread",
      }),
      subscriptionService.sendNotificationToUser(
        org._id,
        JSON.stringify({ title, message, icon: org?.branding?.pwaIcon })
      ),
    ]);
  } catch (e) {
    console.warn("[notifyStoreStockConflict] Error enviando notificaciones:", e?.message || e);
  }
}

/** Formatea el monto del pedido con la moneda de la organización. */
function formatOrderAmount(order, org) {
  const amount = Number(order?.amount) || 0;
  const currency = order?.currency || org?.currency || "COP";
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    // Moneda inválida en la config → fallback simple.
    return `${amount} ${currency}`.trim();
  }
}

/** Detalle del pedido: "2× Shampoo, 1× Cera". */
function buildItemsDetail(order) {
  const items = order?.store?.items || [];
  return items
    .map((i) => `${i.quantity}× ${i.name}`)
    .join(", ");
}

/**
 * 🛍️ WhatsApp "Pago recibido" al COMPRADOR de la tienda (template
 * `paymentReceived`). Se dispara al confirmarse el pago de un Order type
 * "store" (MP/comprobante vía fulfillStoreOrder, o contraentrega vía
 * collectStoreOrder).
 *
 * Respeta el toggle `enabledTypes.paymentReceived` (transaccional: activo por
 * defecto). Best-effort: nunca lanza — cualquier error solo se loguea.
 */
export async function notifyStorePaymentReceived({ org, order }) {
  try {
    const phone = order?.store?.customer?.phone;
    if (!org || !phone) return;

    // sendNotification no consulta enabledTypes — verificar aquí (patrón
    // de appointmentService: deshabilitado solo si es explícitamente false).
    const templateDoc = await WhatsappTemplate.findOne({ organizationId: org._id });
    if (templateDoc?.enabledTypes?.paymentReceived === false) {
      console.log(`⏭️  [notifyStorePaymentReceived] Deshabilitado (enabledTypes.paymentReceived) para org ${org._id}`);
      return;
    }

    await whatsappService.sendNotification(
      org._id.toString(),
      phone,
      "paymentReceived",
      {
        names: order?.store?.customer?.name || "cliente",
        organization: org.name || "",
        monto: formatOrderAmount(order, org),
        detalle: buildItemsDetail(order) || "tu pedido",
      }
    );
  } catch (e) {
    console.warn("[notifyStorePaymentReceived] Error enviando WhatsApp al comprador:", e?.message || e);
  }
}

export default { notifyNewStoreOrder, notifyStoreStockConflict, notifyStorePaymentReceived };
