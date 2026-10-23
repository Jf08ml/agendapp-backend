/**
 * 🔄 Aviso por WhatsApp al cliente cuando el negocio reprograma su cita desde la agenda.
 * - 1 cita  → plantilla `rescheduleAppointment` (antes → ahora)
 * - 2+ citas (serie, "esta y las siguientes") → `rescheduleAppointmentSeries` (lista de nuevos horarios)
 *
 * Solo se llama cuando el admin dejó marcado "Avisar al cliente por WhatsApp".
 * Pasa por la misma compuerta que las confirmaciones (plan autoConfirmations →
 * plantilla habilitada → tope mensual de citas con WhatsApp) y nunca lanza:
 * devuelve { status, reason } para mostrarlo en la agenda.
 */

import appointmentModel from "../models/appointmentModel.js";
import organizationService from "./organizationService.js";
import packageService from "./packageService.js";
import whatsappService from "./sendWhatsappService.js";
import waQuotaService from "./waQuotaService.js";
import { recordConfirmationOutcome } from "./appointmentService.js";
import { weekdayEs } from "../utils/timeAndPhones.js";

const fmtTime = (d, tz, timeFormat) =>
  new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: timeFormat !== "24h",
    timeZone: tz,
  }).format(d);

// "jueves 15 de enero, 03:00 p. m." — mismo formato que la confirmación de citas
const fmtDateTime = (d, tz, timeFormat) =>
  `${weekdayEs(d, tz)} ` +
  new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: timeFormat !== "24h",
    timeZone: tz,
  }).format(d);

const fmtDay = (d, tz) =>
  new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(d);

/**
 * Arma los datos del aviso (sin enviar nada). Separado del envío para poder
 * revisar el mensaje con datos reales.
 * @returns {Promise<{ appointments, templateType, data, phone, timezone } | null>} null si no hay citas
 */
export async function buildRescheduleMessage({ organizationId, appointmentIds, previousStartDate }) {
  const appointments = await appointmentModel
    .find({ _id: { $in: appointmentIds }, organizationId })
    .populate("client", "name phone_e164 phoneNumber")
    .populate("service", "name")
    .populate("employee", "names")
    .sort({ startDate: 1 });
  if (appointments.length === 0) return null;

  const organization = await organizationService.getOrganizationById(organizationId);
  const timezone = organization?.timezone || "America/Bogota";
  const timeFormat = organization?.timeFormat || "12h";
  const first = appointments[0];
  const client = first.client;
  const isSeries = appointments.length > 1;
  const templateType = isSeries ? "rescheduleAppointmentSeries" : "rescheduleAppointment";

  // 🔢 "Drenaje · Sesión 3 de 15" en las citas cubiertas por paquete
  const sessionLabels = await packageService.getPackageSessionLabels(appointments);
  const serviceLabel = (appt) => {
    const name = appt.service?.name?.trim() || "Servicio";
    const s = sessionLabels.get(String(appt._id));
    return s ? `${name} · Sesión ${s.number} de ${s.total}` : name;
  };

  const base = {
    names: client?.name?.trim() || "Estimado cliente",
    organization: organization?.name || "",
    address: organization?.address || "",
    employee: first.employee?.names?.trim() || "Nuestro equipo",
    cancellationLink: appointments.find((a) => a.cancellationLink)?.cancellationLink || "",
  };

  let data;
  if (isSeries) {
    // Agrupado por día: los servicios de una misma visita van juntos
    const byDay = new Map();
    for (const appt of appointments) {
      const day = fmtDay(appt.startDate, timezone);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(
        `     • ${serviceLabel(appt)} (${fmtTime(appt.startDate, timezone, timeFormat)} - ${fmtTime(appt.endDate, timezone, timeFormat)})`
      );
    }
    const appointmentsList = [...byDay.entries()]
      .map(([day, lines], i) => `\n${i + 1}. ${day}\n${lines.join("\n")}`)
      .join("\n");
    data = { ...base, appointmentsList };
  } else {
    data = {
      ...base,
      service: serviceLabel(first),
      date: fmtDateTime(first.startDate, timezone, timeFormat),
      previousDate: previousStartDate ? fmtDateTime(new Date(previousStartDate), timezone, timeFormat) : "",
    };
  }

  return {
    appointments,
    templateType,
    data,
    phone: client?.phone_e164 || client?.phoneNumber || null,
    timezone,
  };
}

/**
 * @param {Object} params
 * @param {string} params.organizationId
 * @param {Array<string>} params.appointmentIds - citas ya movidas (la editada + las siguientes)
 * @param {Date} [params.previousStartDate] - horario anterior (solo para el aviso de 1 cita)
 * @returns {Promise<{ status: "sent"|"blocked"|"skipped"|"failed", reason?: string }>}
 */
export async function notifyClientReschedule({ organizationId, appointmentIds, previousStartDate }) {
  try {
    const message = await buildRescheduleMessage({ organizationId, appointmentIds, previousStartDate });
    if (!message) return { status: "skipped", reason: "No se encontraron las citas" };
    const { appointments, templateType, data, phone, timezone } = message;
    if (!phone) return { status: "skipped", reason: "El cliente no tiene teléfono" };

    const { allowed, reason } = await waQuotaService.confirmationGate(organizationId, appointments, {
      templateType,
      timezone,
    });
    if (reason) return { status: "blocked", reason };

    const sendIds = appointments.filter((a) => allowed.has(String(a._id))).map((a) => a._id);
    const result = await whatsappService.sendNotification(organizationId, phone, templateType, data, {
      externalRef: `reschedule:${sendIds.join(",")}`,
    });
    if (!result || result.blocked) {
      return {
        status: "failed",
        reason: result?.blocked
          ? "Tu plan no incluye WhatsApp"
          : "No se pudo enviar (revisa la conexión de WhatsApp o que la plantilla esté aprobada)",
      };
    }

    // El aviso de reprogramación es la confirmación vigente del nuevo horario
    const messageId = result?.messageId || result?.id || null;
    await recordConfirmationOutcome(sendIds, "sent", undefined, messageId);
    return { status: "sent" };
  } catch (error) {
    console.error("❌ Error enviando aviso de reprogramación:", error.message || error);
    return { status: "failed", reason: error.message || "Error enviando el aviso" };
  }
}

export default { notifyClientReschedule, buildRescheduleMessage };
