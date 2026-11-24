// Cupo apartado mientras el cliente paga el abono (Fase 3).
//
// El checkout de reserva (Mercado Pago o comprobante) ya creaba las reservas
// en "pending" con un Order que vence (expiresAt: 15 min MP, 60 min
// comprobante), pero la disponibilidad solo miraba citas: otra persona podía
// ver y tomar ese mismo horario mientras la primera pagaba.
//
// Aquí esas reservas se convierten en "citas apartadas" (misma forma que una
// cita: startDate, endDate, employee, service) para sumarlas a las citas al
// calcular horarios libres y al validar un checkout nuevo.
//
// Un apartado cuenta mientras su Order:
//   - está "created" o "pending" y no venció (expiresAt en el futuro), o
//   - está "in_review" (comprobante subido, esperando validación).
// Las reservas sin profesional asignado no se pueden ubicar en la agenda de
// nadie y no apartan (el cumplimiento asigna profesional al pagar).
import Reservation from "../models/reservationModel.js";
import Order from "../models/orderModel.js";
import Appointment from "../models/appointmentModel.js";
import Service from "../models/serviceModel.js";

/** ¿El pedido todavía aparta el cupo? (puro) */
export function isHoldActive(order, now = new Date()) {
  if (!order) return false;
  if (order.status === "in_review") return true;
  if (order.status !== "created" && order.status !== "pending") return false;
  return !!order.expiresAt && new Date(order.expiresAt) > now;
}

/** Reserva apartada → forma de cita para el cálculo de horarios (puro). */
export function holdAsAppointment(reservation) {
  const start = new Date(reservation.startDate);
  const durationMin = Number(reservation.serviceId?.duration) || 0;
  return {
    _id: reservation._id,
    startDate: start,
    endDate: new Date(start.getTime() + Math.max(durationMin, 5) * 60000),
    employee: reservation.employeeId?._id ?? reservation.employeeId,
    service: reservation.serviceId?._id ?? reservation.serviceId,
    status: "held",
  };
}

/**
 * Citas apartadas por pagos en curso.
 * @param {{ organizationId, employeeIds?: Array, from: Date, to: Date, excludeGroupId?: any, now?: Date }} q
 */
export async function activeHolds({ organizationId, employeeIds, from, to, excludeGroupId, excludeCustomerId, now = new Date() }) {
  const query = {
    organizationId,
    status: "pending",
    paymentStatus: "pending",
    orderId: { $ne: null },
    employeeId: employeeIds?.length ? { $in: employeeIds } : { $ne: null },
    // Margen de un día hacia atrás: una reserva que empieza antes del rango
    // puede terminar dentro de él.
    startDate: { $gte: new Date(new Date(from).getTime() - 86400000), $lte: to },
  };
  if (excludeGroupId) query.groupId = { $ne: excludeGroupId };
  // El mismo cliente reintentando el pago no se bloquea con su intento anterior
  if (excludeCustomerId) query.customer = { $ne: excludeCustomerId };

  const reservations = await Reservation.find(query).populate("serviceId", "duration").lean();
  if (reservations.length === 0) return [];

  const orderIds = [...new Set(reservations.map((r) => String(r.orderId)))];
  const orders = await Order.find({ _id: { $in: orderIds } }).select("status expiresAt").lean();
  const active = new Set(orders.filter((o) => isHoldActive(o, now)).map((o) => String(o._id)));

  return reservations
    .filter((r) => active.has(String(r.orderId)))
    .map(holdAsAppointment)
    .filter((a) => a.endDate > new Date(from));
}

/** Citas + apartados, para pasar a generateAvailableSlots y similares. */
export async function withHolds(appointments, q) {
  const holds = await activeHolds(q);
  return holds.length ? [...appointments, ...holds] : appointments;
}

/**
 * ¿Cabe una cita más del servicio junto a las que se cruzan? Misma regla que
 * scheduleService (isWithinConcurrency): otra cita de OTRO servicio ocupa al
 * profesional; las del mismo servicio cuentan contra maxConcurrent. (puro)
 */
export function fitsConcurrency(overlapping, serviceId, maxConcurrent = 1) {
  const sid = String(serviceId);
  if (overlapping.some((a) => String(a.service?._id ?? a.service) !== sid)) return false;
  return overlapping.length < Math.max(1, maxConcurrent);
}

const CANCELLED = ["cancelled", "cancelled_by_customer", "cancelled_by_admin"];

/**
 * Antes de crear un checkout (o una reserva pública): ¿algún servicio choca con
 * una cita o con un cupo apartado por otro pago? Los servicios van seguidos
 * desde `start` (Date). Los que no tienen profesional no se validan aquí.
 * @param {{ organizationId, start: Date, items: Array<{ serviceId, employeeId?, duration? }>, excludeCustomerId? }} q
 * @returns {Promise<boolean>} true si hay conflicto
 */
export async function hasSlotConflict({ organizationId, start, items, excludeCustomerId }) {
  const services = await Service.find({ _id: { $in: items.map((i) => i.serviceId) } })
    .select("duration maxConcurrentAppointments")
    .lean();
  const byId = new Map(services.map((s) => [String(s._id), s]));
  let cursor = new Date(start);
  for (const item of items) {
    const svc = byId.get(String(item.serviceId));
    const duration = Number(item.duration) || Number(svc?.duration) || 0;
    const end = new Date(cursor.getTime() + Math.max(duration, 5) * 60000);
    if (item.employeeId) {
      const appts = await Appointment.find({
        organizationId,
        employee: item.employeeId,
        startDate: { $lt: end },
        endDate: { $gt: cursor },
        status: { $nin: CANCELLED },
      })
        .select("startDate endDate employee service")
        .lean();
      const holds = (await activeHolds({ organizationId, employeeIds: [item.employeeId], from: cursor, to: end, excludeCustomerId })).filter(
        (h) => h.startDate < end && h.endDate > cursor
      );
      if (!fitsConcurrency([...appts, ...holds], item.serviceId, svc?.maxConcurrentAppointments ?? 1)) return true;
    }
    cursor = end;
  }
  return false;
}

export default { isHoldActive, holdAsAppointment, activeHolds, withHolds, fitsConcurrency, hasSlotConflict };
