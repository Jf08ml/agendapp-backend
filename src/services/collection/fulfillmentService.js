/**
 * fulfillmentService.js
 *
 * "Cumple" un Order al confirmarse el pago (llamado desde el webhook de MP).
 * Despacha según `order.type`:
 *  - reservation → aprueba el grupo de reservas (crea las citas + WhatsApp).
 *  - class       → confirma las inscripciones del grupo (pending_payment → confirmed/pending).
 *  - package     → crea el ClientPackage (compra de paquete pagada online).
 *  - store       → registra la venta en caja (ProductSale, descuento atómico de
 *                  stock + alerta stock bajo) y notifica el pedido al admin.
 *
 * Cada handler es idempotente a nivel de efecto (busca el estado pendiente y, si
 * ya no existe, no hace nada); la idempotencia por evento la garantiza el Order
 * (`processedEventIds`) antes de llamar aquí.
 */

import Reservation from "../../models/reservationModel.js";
import Appointment from "../../models/appointmentModel.js";
import Order from "../../models/orderModel.js";
import Organization from "../../models/organizationModel.js";
import reservationService from "../reservationService.js";
import enrollmentService from "../enrollmentService.js";
import packageService from "../packageService.js";
import productService from "../productService.js";
import { notifyNewStoreOrder, notifyStoreStockConflict } from "./storeNotifier.js";

// Nota con la que se marca el abono del depósito online en Appointment.payments[]
// (se usa también como guarda de idempotencia para no duplicar el registro).
const DEPOSIT_PAYMENT_NOTE = "Depósito (pago online)";

/**
 * reservation: aprueba la primera reserva del grupo (crea las citas + WhatsApp),
 * marca el grupo como pagado y registra el depósito en cada cita creada para que
 * aparezca en el seguimiento de pagos.
 */
async function fulfillReservationOrder(order) {
  const groupReservations = await Reservation.find({ groupId: order.refId });
  if (groupReservations.length === 0) return;

  await reservationService.updateReservation(String(groupReservations[0]._id), {
    status: "approved",
  });
  await Reservation.updateMany({ groupId: order.refId }, { paymentStatus: "paid" });

  // Propagar el depósito pagado al seguimiento de pagos de cada cita.
  // Cada Reservation guarda su parte del depósito (`depositAmount`) y queda
  // vinculada a su cita vía `appointmentId`. Replica el patrón de las clases
  // (enrollmentService.confirmPaidEnrollmentGroup): registra un pago en
  // Appointment.payments[] para que el abono se vea en la agenda.
  const method = order.provider === "receipt" ? "transfer" : "card";
  const approved = await Reservation.find({ groupId: order.refId });
  for (const r of approved) {
    if (!r.appointmentId || !(r.depositAmount > 0)) continue;
    const appt = await Appointment.findById(r.appointmentId);
    if (!appt) continue;
    // Idempotencia: no duplicar el abono si ya quedó registrado.
    const alreadyRegistered = (appt.payments || []).some(
      (p) => p.note === DEPOSIT_PAYMENT_NOTE
    );
    if (alreadyRegistered) continue;
    appt.payments.push({
      amount: r.depositAmount,
      method,
      note: DEPOSIT_PAYMENT_NOTE,
    });
    await appt.save(); // pre-save recalcula paymentStatus
  }
}

/**
 * class: confirma las inscripciones del grupo retenido tras el pago del depósito.
 */
async function fulfillClassOrder(order) {
  await enrollmentService.confirmPaidEnrollmentGroup(order.refId, {
    depositAmount: order.amount,
  });
}

/**
 * package: crea el ClientPackage para el comprador (asignación = entrega del paquete).
 */
async function fulfillPackageOrder(order) {
  const servicePackageId = order.metadata?.servicePackageId || order.refId;
  const clientId = order.metadata?.clientId;
  if (!servicePackageId || !clientId) {
    throw new Error("Order de paquete sin servicePackageId/clientId en metadata.");
  }

  await packageService.assignPackageToClient(
    servicePackageId,
    clientId,
    order.organizationId,
    { paymentMethod: "mercadopago", paymentNotes: "Compra online (Mercado Pago)" }
  );
}

/**
 * store: el pago del pedido se confirmó → registrar la venta en caja
 * (productService.createSale: descuento ATÓMICO de stock + comisión + alerta de
 * stock bajo) y notificar el pedido nuevo al admin.
 *
 * Decisión 2 del plan: si al pagar ya no hay stock, el fulfillment NO revienta
 * (el pago no se revierte) — el pedido queda pagado sin venta y se notifica el
 * conflicto para que el admin lo resuelva manualmente.
 *
 * Mapeo de método en la ProductSale: comprobante → "transfer"; MP → "other"
 * con nota "Tienda online · Mercado Pago". (COD no pasa por aquí: la venta la
 * crea el admin en POST /store-orders/:id/collect con el método que elija.)
 */
async function fulfillStoreOrder(order) {
  // Idempotencia a nivel de efecto: si ya hay venta vinculada, no repetir.
  if (order.store?.saleId) return;

  const org = await Organization.findById(order.organizationId);
  if (!org) throw new Error("Organización no encontrada para el pedido de tienda.");

  const method = order.provider === "receipt" ? "transfer" : "other";
  const note =
    order.provider === "receipt"
      ? "Tienda online · Transferencia (comprobante)"
      : "Tienda online · Mercado Pago";

  try {
    const sale = await productService.createSale(org, {
      items: (order.store?.items || []).map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      method,
      note,
      clientId: null,
    });

    // Trazabilidad: vincular la venta al pedido (updateOne para no pisar el
    // status, que lo maneja el caller: markOrderPaid / claim de submitReceipt).
    order.store.saleId = sale._id;
    await Order.updateOne({ _id: order._id }, { $set: { "store.saleId": sale._id } });
  } catch (err) {
    // Conflicto de stock (u otro fallo al registrar la venta): NO propagar — el
    // pedido queda pagado y el admin recibe el aviso de conflicto.
    console.error(`[fulfillStoreOrder] Venta no registrada para Order ${order._id}:`, err?.message || err);
    notifyStoreStockConflict({ org, order, reason: err?.message }).catch((e) =>
      console.warn("[fulfillStoreOrder] notifyStoreStockConflict falló:", e?.message || e)
    );
  }

  // Notificar el pedido nuevo (best-effort; nunca rompe el flujo de pago).
  notifyNewStoreOrder({ org, order }).catch((e) =>
    console.warn("[fulfillStoreOrder] notifyNewStoreOrder falló:", e?.message || e)
  );
}

/**
 * Despachador por tipo. Lanza si el tipo no está soportado.
 */
export async function fulfillOrder(order) {
  switch (order.type) {
    case "reservation":
      return fulfillReservationOrder(order);
    case "class":
      return fulfillClassOrder(order);
    case "package":
      return fulfillPackageOrder(order);
    case "store":
      return fulfillStoreOrder(order);
    default:
      throw new Error(`Tipo de Order no soportado: ${order.type}`);
  }
}

/**
 * Libera el "hold" de un Order que NO se va a cumplir (pago rechazado/expirado).
 * Misma lógica que `cron/orderExpiryJob`: reserva→rejected, clase→libera cupo,
 * paquete→nada. Idempotente.
 */
export async function releaseOrderHold(order, reason = "Pago no confirmado.") {
  if (order.type === "reservation" && order.refId) {
    await Reservation.updateMany(
      { groupId: order.refId, status: "pending", paymentStatus: "pending" },
      { status: "rejected", errorMessage: reason }
    );
  } else if (order.type === "class" && order.refId) {
    await enrollmentService.releaseEnrollmentHold(order.refId);
  }
  // package: no retiene cupo.
  // store: no-op — el stock NO se retiene al crear el pedido (solo se valida);
  // se descuenta al confirmarse el pago, así que no hay hold que liberar.
}

export default { fulfillOrder, releaseOrderHold };
