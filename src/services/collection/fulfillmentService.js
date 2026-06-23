/**
 * fulfillmentService.js
 *
 * "Cumple" un Order al confirmarse el pago (llamado desde el webhook de MP).
 * Despacha según `order.type`:
 *  - reservation → aprueba el grupo de reservas (crea las citas + WhatsApp).
 *  - class       → confirma las inscripciones del grupo (pending_payment → confirmed/pending).
 *  - package     → crea el ClientPackage (compra de paquete pagada online).
 *
 * Cada handler es idempotente a nivel de efecto (busca el estado pendiente y, si
 * ya no existe, no hace nada); la idempotencia por evento la garantiza el Order
 * (`processedEventIds`) antes de llamar aquí.
 */

import Reservation from "../../models/reservationModel.js";
import Appointment from "../../models/appointmentModel.js";
import reservationService from "../reservationService.js";
import enrollmentService from "../enrollmentService.js";
import packageService from "../packageService.js";

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
}

export default { fulfillOrder, releaseOrderHold };
