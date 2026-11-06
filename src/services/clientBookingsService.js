/**
 * clientBookingsService.js
 *
 * "Mis reservas": próximas citas, reservas pendientes de aprobación e
 * inscripciones a clases del cliente, en dos niveles:
 *
 *  - Consulta por teléfono (/mis-reservas): solo lectura, sin historial.
 *    Cualquiera que sepa el número puede verla — decisión del negocio
 *    (2026-11-06) a cambio de no depender de WhatsApp para consultar.
 *  - Enlace personal (/mis-reservas/:token): además permite cancelar. Llega
 *    SIEMPRE por WhatsApp (canal de la org), así cancelar exige tener el
 *    teléfono del cliente, no solo saber el número. Sin fallback directo.
 */

import crypto from "crypto";
import Client from "../models/clientModel.js";
import Organization from "../models/organizationModel.js";
import Appointment from "../models/appointmentModel.js";
import Reservation from "../models/reservationModel.js";
import Enrollment from "../models/enrollmentModel.js";
import "../models/classSessionModel.js";
import "../models/classModel.js";
import clientService from "./clientService.js";
import whatsappService from "./sendWhatsappService.js";
import cancellationService, { appointmentCancelPolicy } from "./cancellationService.js";
import enrollmentService from "./enrollmentService.js";
import whatsappTemplates from "../utils/whatsappTemplates.js";
import { resolveBaseUrl } from "../utils/cancellationUtils.js";

const TOKEN_RE = /^[A-Za-z0-9_-]{10,64}$/;

function newToken() {
  return crypto.randomBytes(16).toString("base64url"); // 22 caracteres
}

/** Token del cliente, creándolo si aún no tiene (atómico). */
export async function ensureBookingsToken(client) {
  if (client.bookingsToken) return client.bookingsToken;
  const updated = await Client.findOneAndUpdate(
    { _id: client._id, bookingsToken: { $exists: false } },
    { $set: { bookingsToken: newToken() } },
    { new: true }
  ).select("bookingsToken");
  if (updated?.bookingsToken) return updated.bookingsToken;
  const fresh = await Client.findById(client._id).select("bookingsToken").lean();
  return fresh?.bookingsToken || null;
}

export function buildBookingsUrl(org, token) {
  return `${resolveBaseUrl(org)}/mis-reservas/${token}`;
}

const ORG_FIELDS = "name slug domains branding timezone timeFormat cancellationPolicy enableOnlineBooking enableClassBooking";

async function loadByToken(token) {
  if (!token || typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const client = await Client.findOne({ bookingsToken: token })
    .select("name phone_e164 organizationId")
    .lean();
  if (!client) return null;
  const org = await Organization.findById(client.organizationId).select(ORG_FIELDS).lean();
  if (!org) return null;
  return { client, org };
}

/** Filtro "es de este cliente" por id o, si no quedó vinculado, por teléfono. */
function ownerOr(idField, phoneField, client) {
  const or = [{ [idField]: client._id }];
  if (client.phone_e164) or.push({ [phoneField]: client.phone_e164 });
  return or;
}

const CANCELLED_APPT = ["cancelled", "cancelled_by_customer", "cancelled_by_admin"];
const HISTORY_LIMIT = 10;

/**
 * Vista pública por token: nombre del cliente + citas, reservas pendientes e
 * inscripciones futuras (con si se pueden cancelar y por qué no) + historial.
 * No expone teléfono, email ni ids del cliente.
 */
export async function getBookings(token) {
  const ctx = await loadByToken(token);
  if (!ctx) return null;
  return buildBookingsView(ctx.client, ctx.org, { readOnly: false });
}

/**
 * Consulta de solo lectura por teléfono (sin enlace). null si el número no es
 * de un cliente de la org. Sin historial ni posibilidad de cancelar.
 */
export async function lookupBookingsByPhone(org, phone) {
  let client = null;
  try {
    client = await clientService.getClientByPhoneNumberAndOrganization(phone, org._id);
  } catch {
    client = null; // lanza "Cliente no encontrado"
  }
  if (!client) return null;
  const fullOrg = await Organization.findById(org._id).select(ORG_FIELDS).lean();
  if (!fullOrg) return null;
  return buildBookingsView(
    { _id: client._id, name: client.name, phone_e164: client.phone_e164 || null },
    fullOrg,
    { readOnly: true }
  );
}

async function buildBookingsView(client, org, { readOnly }) {
  const now = new Date();

  const [upcomingAppts, pastAppts, pendingRes, enrollments] = await Promise.all([
    Appointment.find({
      organizationId: org._id,
      client: client._id,
      endDate: { $gte: now },
      status: { $nin: CANCELLED_APPT },
    })
      .select("service employee startDate endDate status clientConfirmed")
      .populate("service", "name")
      .populate("employee", "names")
      .sort({ startDate: 1 })
      .limit(100)
      .lean(),
    readOnly
      ? []
      : Appointment.find({ organizationId: org._id, client: client._id, startDate: { $lt: now } })
          .select("service employee startDate endDate status")
          .populate("service", "name")
          .populate("employee", "names")
          .sort({ startDate: -1 })
          .limit(HISTORY_LIMIT)
          .lean(),
    Reservation.find({
      organizationId: org._id,
      status: "pending",
      appointmentId: null,
      startDate: { $gte: now },
      $or: ownerOr("customer", "customerDetails.phone_e164", client),
    })
      .select("serviceId employeeId startDate status")
      .populate("serviceId", "name")
      .populate("employeeId", "names")
      .sort({ startDate: 1 })
      .limit(50)
      .lean(),
    Enrollment.find({
      organizationId: org._id,
      status: { $ne: "cancelled" },
      $or: ownerOr("clientId", "attendee.phone_e164", client),
    })
      .select("sessionId classId status attendee.name")
      .populate({ path: "sessionId", select: "startDate endDate status employeeId", populate: { path: "employeeId", select: "names" } })
      .populate("classId", "name")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),
  ]);

  const appointments = upcomingAppts.map((a) => {
    const p = appointmentCancelPolicy(a, org);
    return {
      id: a._id,
      serviceName: a.service?.name || "Servicio",
      employeeName: a.employee?.names || null,
      startDate: a.startDate,
      endDate: a.endDate,
      status: a.status,
      clientConfirmed: !!a.clientConfirmed,
      canCancel: !p.isPast && !p.isCancelled && !p.policyBlocked,
      cancelBlockedReason: p.isPast ? "La cita ya comenzó" : p.policyBlockedReason,
    };
  });

  const pendingReservations = pendingRes.map((r) => {
    const p = appointmentCancelPolicy(r, org, { checkConfirmed: false });
    return {
      id: r._id,
      serviceName: r.serviceId?.name || "Servicio",
      employeeName: r.employeeId?.names || null,
      startDate: r.startDate,
      status: "pending_approval",
      canCancel: !p.isPast && !p.policyBlocked,
      cancelBlockedReason: p.policyBlockedReason,
    };
  });

  const classes = enrollments
    .filter((e) => e.sessionId?.startDate && new Date(e.sessionId.endDate || e.sessionId.startDate) >= now)
    .filter((e) => e.sessionId.status !== "cancelled")
    .map((e) => {
      const started = new Date(e.sessionId.startDate) < now;
      // pending_payment: el cupo está retenido por un pago en curso; si se
      // cancelara aquí, la expiración de la orden lo liberaría otra vez.
      const awaitingPayment = e.status === "pending_payment";
      return {
        id: e._id,
        className: e.classId?.name || "Clase",
        attendeeName: e.attendee?.name || null,
        instructorName: e.sessionId.employeeId?.names || null,
        startDate: e.sessionId.startDate,
        endDate: e.sessionId.endDate,
        status: e.status,
        canCancel: !started && !awaitingPayment,
        cancelBlockedReason: started
          ? "La clase ya comenzó"
          : awaitingPayment
          ? "Tienes un pago pendiente para esta clase"
          : null,
      };
    })
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  const history = pastAppts.map((a) => ({
    id: a._id,
    serviceName: a.service?.name || "Servicio",
    employeeName: a.employee?.names || null,
    startDate: a.startDate,
    status: a.status,
  }));

  return {
    // Solo lectura: el front oculta los botones de cancelar; el endpoint de
    // cancelación igual exige el token del enlace.
    readOnly,
    client: { name: client.name },
    organization: {
      name: org.name,
      timezone: org.timezone || "America/Bogota",
      timeFormat: org.timeFormat || "12h",
      logoUrl: org.branding?.logoUrl || null,
      enableOnlineBooking: org.enableOnlineBooking !== false,
      enableClassBooking: !!org.enableClassBooking,
      cancellationPolicy: {
        minHoursBeforeAppointment: org.cancellationPolicy?.minHoursBeforeAppointment || 0,
      },
    },
    appointments,
    pendingReservations,
    classes,
    history,
  };
}

/**
 * Cancela una cita, reserva pendiente o inscripción del dueño del token. Valida
 * propiedad y política con las mismas reglas del enlace de cancelación.
 *
 * @param {"appointment"|"reservation"|"enrollment"} type
 * @returns {{ success: boolean, message: string }}
 */
export async function cancelBooking(token, type, id) {
  const ctx = await loadByToken(token);
  if (!ctx) return { success: false, status: 404, message: "Enlace inválido." };
  const { client, org } = ctx;
  if (!id || !/^[a-f0-9]{24}$/i.test(String(id))) {
    return { success: false, status: 400, message: "Reserva inválida." };
  }

  if (type === "appointment") {
    const appt = await Appointment.findOne({ _id: id, organizationId: org._id, client: client._id })
      .select("startDate status clientConfirmed")
      .lean();
    if (!appt) return { success: false, status: 404, message: "Cita no encontrada." };
    const p = appointmentCancelPolicy(appt, org);
    if (p.isCancelled) return { success: false, status: 409, message: "Esta cita ya estaba cancelada." };
    if (p.isPast) return { success: false, status: 409, message: "No se pueden cancelar citas pasadas." };
    if (p.policyBlocked) return { success: false, status: 409, message: p.policyBlockedReason };
    // Mismo camino que el enlace de WhatsApp: estado, paquete, reserva
    // vinculada, mensaje al cliente y aviso al negocio.
    const result = await cancellationService.cancelAppointmentsInGroup([appt._id]);
    return { ...result, status: result.success ? 200 : 400 };
  }

  if (type === "reservation") {
    const res = await Reservation.findOne({
      _id: id,
      organizationId: org._id,
      status: "pending",
      $or: ownerOr("customer", "customerDetails.phone_e164", client),
    })
      .select("startDate status")
      .lean();
    if (!res) return { success: false, status: 404, message: "Reserva no encontrada." };
    const p = appointmentCancelPolicy(res, org, { checkConfirmed: false });
    if (p.isPast) return { success: false, status: 409, message: "No se pueden cancelar reservas pasadas." };
    if (p.policyBlocked) return { success: false, status: 409, message: p.policyBlockedReason };
    const result = await cancellationService.cancelReservation(res._id);
    return { ...result, status: result.success ? 200 : 400 };
  }

  if (type === "enrollment") {
    const e = await Enrollment.findOne({
      _id: id,
      organizationId: org._id,
      $or: ownerOr("clientId", "attendee.phone_e164", client),
    })
      .select("status sessionId")
      .populate("sessionId", "startDate")
      .lean();
    if (!e) return { success: false, status: 404, message: "Inscripción no encontrada." };
    if (e.status === "cancelled") return { success: false, status: 409, message: "Esta inscripción ya estaba cancelada." };
    if (e.status === "pending_payment") {
      return { success: false, status: 409, message: "Tienes un pago pendiente para esta clase." };
    }
    if (!e.sessionId?.startDate || new Date(e.sessionId.startDate) < new Date()) {
      return { success: false, status: 409, message: "La clase ya comenzó." };
    }
    await enrollmentService.cancelEnrollment(e._id, "customer");
    return { success: true, status: 200, message: "Inscripción cancelada." };
  }

  return { success: false, status: 400, message: "Tipo de reserva no soportado." };
}

// Anti-spam del envío por WhatsApp: 1 envío por cliente y org cada 2 minutos
// (en memoria; el rate limit general de la API sigue aplicando).
const REQUEST_COOLDOWN_MS = 2 * 60 * 1000;
const lastRequestAt = new Map();

/**
 * Página pública /mis-reservas: el cliente escribe su teléfono y se le envía
 * el enlace por WhatsApp.
 *
 * @returns {{ status: "not_found" | "sent" | "cooldown" | "unavailable" }}
 */
export async function requestBookingsLink(org, phone) {
  let client = null;
  try {
    client = await clientService.getClientByPhoneNumberAndOrganization(phone, org._id);
  } catch {
    client = null; // lanza "Cliente no encontrado"
  }
  if (!client) return { status: "not_found" };

  const destination = client.phone_e164 || client.phoneNumber;
  if (!destination) return { status: "unavailable" };

  const key = `${org._id}:${client._id}`;
  const last = lastRequestAt.get(key);
  if (last && Date.now() - last < REQUEST_COOLDOWN_MS) return { status: "cooldown" };
  lastRequestAt.set(key, Date.now());

  const token = await ensureBookingsToken(client);
  const orgId = String(org._id);
  const data = {
    names: client.name || "",
    organization: org.name || "",
    bookingsUrl: buildBookingsUrl(org, token),
  };
  try {
    // Plantilla "myBookingsLink": Baileys la envía como texto (editable en
    // Mensajes de WhatsApp); Meta usa la plantilla aprobada "mis_reservas" — el
    // cliente lo pide desde la web, casi nunca hay ventana de 24 h abierta.
    const fallbackMessage = await whatsappTemplates.getRenderedTemplate(orgId, "myBookingsLink", data);
    const result = await whatsappService.sendNotification(orgId, destination, "myBookingsLink", data, {
      fallbackMessage,
    });
    if (result && !result.blocked) return { status: "sent" };
  } catch (err) {
    console.warn(`[clientBookings] No se pudo enviar el enlace por WhatsApp (org ${org._id}):`, err?.message || err);
  }
  lastRequestAt.delete(key);
  return { status: "unavailable" };
}

/** Enlace de un cliente para el panel admin (lo crea si hace falta). */
export async function getClientBookingsLink(org, clientId) {
  const client = await Client.findOne({ _id: clientId, organizationId: org._id }).select("bookingsToken");
  if (!client) return null;
  const token = await ensureBookingsToken(client);
  return { token, url: buildBookingsUrl(org, token) };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, t] of lastRequestAt) if (now - t > REQUEST_COOLDOWN_MS) lastRequestAt.delete(k);
}, 10 * 60 * 1000).unref?.();

export default {
  ensureBookingsToken,
  buildBookingsUrl,
  getBookings,
  lookupBookingsByPhone,
  cancelBooking,
  requestBookingsLink,
  getClientBookingsLink,
};
