/**
 * lowStockNotifier.js
 *
 * Notifica al admin cuando productos del inventario quedan con stock bajo:
 *  - Notificación in-app (modelo Notification).
 *  - Push web (VAPID) — mismo patrón que las reservas (userId = org._id).
 *
 * Anti-spam: solo notifica productos con `lowStockNotifiedAt: null` y los sella
 * tras notificar; el sello se resetea al reabastecer (ver productService.adjustStock).
 *
 * Best-effort: ningún fallo de notificación debe romper la venta.
 */

import Product from "../models/productModel.js";
import notificationService from "./notificationService.js";
import subscriptionService from "./subscriptionService.js";

/**
 * @param {Object} p
 * @param {Object} p.org       Organization (necesita _id, branding)
 * @param {Array}  p.products  Productos con stock bajo (name, stockQuantity)
 */
export async function notifyLowStock({ org, products }) {
  if (!products || products.length === 0) return;

  const detail = products
    .map((p) => `${p.name} (quedan ${p.stockQuantity})`)
    .join(", ");

  const title = "Stock bajo en inventario ⚠️";
  const message = `⚠️ Stock bajo: ${detail}. Revisa tu inventario para reabastecer.`;

  // 1) In-app + 2) Push (no se interrumpen entre sí).
  await Promise.allSettled([
    notificationService.createNotification({
      title,
      message,
      organizationId: org._id,
      type: "system",
      frontendRoute: "/inventario",
      status: "unread",
    }),
    subscriptionService.sendNotificationToUser(
      org._id,
      JSON.stringify({ title, message, icon: org?.branding?.pwaIcon })
    ),
  ]);
}

/**
 * Revisa los productos indicados y notifica (agrupado) los que cruzaron el
 * umbral y aún no fueron notificados. Sella `lowStockNotifiedAt` tras notificar.
 *
 * @param {Object} p
 * @param {Object} p.org         Organization
 * @param {Array}  p.productIds  Ids de productos a revisar (los de la venta)
 */
export async function checkAndNotifyLowStock({ org, productIds }) {
  if (!productIds || productIds.length === 0) return;

  const lowStockProducts = await Product.find({
    _id: { $in: productIds },
    organizationId: org._id,
    trackStock: true,
    lowStockThreshold: { $gt: 0 },
    lowStockNotifiedAt: null,
    $expr: { $lte: ["$stockQuantity", "$lowStockThreshold"] },
  });

  if (lowStockProducts.length === 0) return;

  await notifyLowStock({ org, products: lowStockProducts });

  // Sellar para no re-notificar hasta que el stock vuelva a subir del umbral
  await Product.updateMany(
    { _id: { $in: lowStockProducts.map((p) => p._id) }, lowStockNotifiedAt: null },
    { lowStockNotifiedAt: new Date() }
  );
}

export default { notifyLowStock, checkAndNotifyLowStock };
