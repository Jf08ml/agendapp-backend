/**
 * orderSummary.js
 *
 * Describe un Order cobrado al cliente en lenguaje natural para los avisos al
 * admin: quién pagó (`customerName`) y qué pagó (`concept`), p. ej.
 *   { customerName: "María Pérez", concept: "el abono de Uñas acrílicas (jueves 5 nov, 3:00 p. m.)" }
 *
 * Lee la reserva / inscripción / paquete / pedido vinculado al Order. Nunca
 * lanza: ante cualquier fallo devuelve lo que pudo resolver (o nulls), porque
 * se usa en notificaciones best-effort.
 *
 * (La bandeja de comprobantes — receiptController.listReceiptOrders — resuelve
 * los mismos vínculos en lote para 200 órdenes; esto es la versión de una sola.)
 */

import moment from "moment-timezone";
import Reservation from "../../models/reservationModel.js";
import Enrollment from "../../models/enrollmentModel.js";
import ServicePackage from "../../models/servicePackageModel.js";
import Client from "../../models/clientModel.js";
import "../../models/serviceModel.js"; // populate de Reservation.serviceId
import "../../models/employeeModel.js"; // populate de Reservation.employeeId
import "../../models/classSessionModel.js"; // populate de Enrollment.sessionId
import "../../models/classModel.js"; // populate de ClassSession.classId

/** "jueves 5 nov, 3:00 p. m." en la zona y formato de hora de la org. */
function formatWhen(date, org) {
  if (!date) return "";
  const tz = org?.timezone || "America/Bogota";
  const timeFmt = org?.timeFormat === "24h" ? "HH:mm" : "h:mm a";
  return moment(date).tz(tz).locale("es").format(`dddd D MMM, ${timeFmt}`).replace(/\./g, "");
}

/** Lista legible: "A", "A y B", "A, B y C" (sin repetidos). */
function joinNames(names) {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length <= 1) return unique[0] || "";
  return `${unique.slice(0, -1).join(", ")} y ${unique[unique.length - 1]}`;
}

/** Fecha de la primera ocurrencia + cuántas más ("… y 2 fechas más"). */
function datesSuffix(dates, org) {
  const sorted = dates.filter(Boolean).map((d) => new Date(d)).sort((a, b) => a - b);
  if (!sorted.length) return "";
  const first = formatWhen(sorted[0], org);
  const extra = sorted.length - 1;
  return extra > 0 ? ` (${first} y ${extra} fecha${extra === 1 ? "" : "s"} más)` : ` (${first})`;
}

async function describeReservation(order, org) {
  if (!order.refId) return { customerName: null, concept: "una reserva" };
  const rs = await Reservation.find({ groupId: order.refId })
    .populate("serviceId", "name")
    .select("serviceId startDate customerDetails")
    .sort({ startDate: 1 })
    .lean();
  if (!rs.length) return { customerName: null, concept: "una reserva" };

  const services = joinNames(rs.map((r) => r.serviceId?.name));
  // Varias reservas del mismo día = una visita multi-servicio → solo la hora de inicio.
  const tz = org?.timezone || "America/Bogota";
  const days = new Set(rs.map((r) => moment(r.startDate).tz(tz).format("YYYY-MM-DD")));
  const when = days.size > 1 ? datesSuffix(rs.map((r) => r.startDate), org) : ` (${formatWhen(rs[0].startDate, org)})`;
  return {
    customerName: rs[0].customerDetails?.name?.trim() || null,
    concept: `el abono de ${services || "una reserva"}${when}`,
  };
}

async function describeClass(order, org) {
  if (!order.refId) return { customerName: null, concept: "una clase" };
  const es = await Enrollment.find({ groupId: order.refId })
    .populate({ path: "sessionId", select: "startDate classId", populate: { path: "classId", select: "name" } })
    .select("sessionId attendee")
    .lean();
  if (!es.length) return { customerName: null, concept: "una clase" };

  const classes = joinNames(es.map((e) => e.sessionId?.classId?.name));
  // Una inscripción por asistente y sesión: fechas únicas por sesión.
  const sessionDates = new Map();
  for (const e of es) if (e.sessionId?._id) sessionDates.set(String(e.sessionId._id), e.sessionId.startDate);
  const attendees = new Set(es.map((e) => e.attendee?.name?.trim()).filter(Boolean));
  const people = attendees.size > 1 ? ` para ${attendees.size} personas` : "";
  return {
    customerName: es[0].attendee?.name?.trim() || null,
    concept: `${classes ? `la clase ${classes}` : "una clase"}${datesSuffix([...sessionDates.values()], org)}${people}`,
  };
}

async function describePackage(order) {
  const packageId = order.metadata?.servicePackageId || order.refId;
  const [client, pkg] = await Promise.all([
    order.metadata?.clientId ? Client.findById(order.metadata.clientId).select("name").lean() : null,
    packageId ? ServicePackage.findById(packageId).select("name tiers").lean() : null,
  ]);
  const tier = order.metadata?.tierId
    ? (pkg?.tiers || []).find((t) => String(t._id) === String(order.metadata.tierId))
    : null;
  const name = pkg?.name ? `el paquete ${pkg.name}${tier?.label ? ` (${tier.label})` : ""}` : "un paquete";
  return { customerName: client?.name?.trim() || null, concept: name };
}

function describeStore(order) {
  const items = order.store?.items || [];
  const parts = items.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.name || "producto"}`);
  const concept = parts.length
    ? parts.length > 3
      ? `un pedido de ${parts.slice(0, 3).join(", ")} y ${parts.length - 3} más`
      : `un pedido de ${joinNames(parts)}`
    : "un pedido de la tienda";
  return { customerName: order.store?.customer?.name?.trim() || null, concept };
}

/**
 * @param {Object} order  Order (lean o documento)
 * @param {Object} org    Organization (usa timezone y timeFormat)
 * @returns {Promise<{ customerName: string|null, concept: string }>}
 */
export async function describeOrder(order, org) {
  try {
    switch (order?.type) {
      case "reservation":
        return await describeReservation(order, org);
      case "class":
        return await describeClass(order, org);
      case "package":
        return await describePackage(order);
      case "store":
        return describeStore(order);
      default:
        return { customerName: null, concept: "un pago" };
    }
  } catch (err) {
    console.warn("[orderSummary] No se pudo describir el Order:", err?.message || err);
    return { customerName: null, concept: "un pago" };
  }
}

/** "50.000 COP" — mismo monto que antes, con separador de miles. */
export function formatOrderAmount(order) {
  const n = Number(order?.amount);
  // Enteros sin decimales (COP, CLP, ARS…); con centavos siempre 2 (25,50 USD).
  const digits = Number.isInteger(n) ? 0 : 2;
  const value = Number.isFinite(n)
    ? n.toLocaleString("es-CO", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : order?.amount;
  return `${value} ${order?.currency || ""}`.trim();
}

export default { describeOrder, formatOrderAmount };
