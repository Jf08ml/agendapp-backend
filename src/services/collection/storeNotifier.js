/**
 * storeNotifier.js
 *
 * Notificaciones al admin por pedidos de la TIENDA pública (Order type "store").
 * Copia el patrón de notifyNewBooking (reservationController.js): notificación
 * in-app (modelo Notification) + push web (VAPID, userId = org._id).
 *
 * Best-effort: ningún fallo de notificación debe romper el flujo de pago.
 */

import notificationService from "../notificationService.js";
import subscriptionService from "../subscriptionService.js";

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

export default { notifyNewStoreOrder, notifyStoreStockConflict };
