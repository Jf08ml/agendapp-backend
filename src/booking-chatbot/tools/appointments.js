import mongoose from "mongoose";
import moment from "moment-timezone";
import Client from "../../models/clientModel.js";
import Appointment from "../../models/appointmentModel.js";
import appointmentService from "../../services/appointmentService.js";

const IDENTIFIER_FIELD_MAP = {
  phone: "phone_e164",
  email: "email",
  documentId: "documentId",
};

const DAY_NAMES = [
  "domingo", "lunes", "martes", "miércoles",
  "jueves", "viernes", "sábado",
];
const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const STATUS_LABELS = {
  pending: "pendiente de confirmación",
  confirmed: "confirmada",
  attended: "atendida",
  no_show: "no asistió",
};

export const getMyAppointments = {
  name: "get_my_appointments",
  description:
    "Consulta las citas futuras (desde hoy inclusive) de un cliente a partir de su identificador. " +
    "Úsala SOLO cuando el cliente pida explícitamente ver sus citas agendadas. No la uses de forma proactiva.",
  parameters: {
    identifier: {
      type: "string",
      description:
        "Valor del identificador del cliente: teléfono (en cualquier formato — con o sin código de país, " +
        "espacios o guiones), email, o número de documento — según lo que configure el negocio.",
      required: true,
    },
  },
  handler: async ({ identifier }, { organizationId, organization }) => {
    const identifierField =
      organization.clientFormConfig?.identifierField || "phone";
    const dbField = IDENTIFIER_FIELD_MAP[identifierField] || "phone_e164";

    let client;
    if (identifierField === "phone") {
      // Matching tolerante: compara los últimos 10 dígitos para ignorar
      // código de país, espacios, guiones o el "+" (el cliente escribe
      // su número en cualquier formato).
      const digits = String(identifier || "").replace(/\D/g, "");
      if (!digits) {
        return { found: false, message: "El teléfono proporcionado no es válido." };
      }
      const last10 = digits.slice(-10);
      client = await Client.findOne({
        organizationId,
        $or: [
          { phone_e164: { $regex: `${last10}$` } },
          { phoneNumber: { $regex: `${last10}$` } },
        ],
      })
        .select("_id name")
        .lean();
    } else {
      client = await Client.findOne({
        organizationId,
        [dbField]: identifier,
      })
        .select("_id name")
        .lean();
    }

    if (!client) {
      return {
        found: false,
        message:
          "No se encontró ningún cliente registrado con ese identificador en este negocio.",
      };
    }

    const now = new Date();
    const appointments = await Appointment.find({
      organizationId,
      client: client._id,
      startDate: { $gte: now },
      status: {
        $nin: ["cancelled", "cancelled_by_customer", "cancelled_by_admin"],
      },
    })
      .sort({ startDate: 1 })
      .limit(10)
      .populate("service", "name")
      .populate("employee", "names")
      .lean();

    if (!appointments.length) {
      return {
        found: true,
        clientName: client.name,
        appointments: [],
      };
    }

    const timezone = organization.timezone || "America/Bogota";

    const formatted = appointments.map((apt) => {
      const m = moment(apt.startDate).tz(timezone);
      return {
        id: apt._id.toString(),
        date: `${DAY_NAMES[m.day()]} ${m.date()} de ${MONTH_NAMES[m.month()]} de ${m.year()}`,
        time: m.format("h:mm A"),
        service: apt.service?.name || "Servicio",
        professional: apt.employee?.names || "Profesional asignado",
        status: STATUS_LABELS[apt.status] || apt.status,
      };
    });

    return {
      found: true,
      clientName: client.name,
      appointments: formatted,
    };
  },
};

// Resuelve el cliente dueño de una cita a partir del mismo identificador que
// usa get_my_appointments — tolerante en teléfono (últimos 10 dígitos).
// Se usa para verificar que quien pide el reagendado es realmente el dueño de
// la cita, en vez de confiar en que el modelo solo pase IDs correctos.
async function resolveOwnerClient(identifier, organizationId, organization) {
  const identifierField = organization.clientFormConfig?.identifierField || "phone";
  const dbField = IDENTIFIER_FIELD_MAP[identifierField] || "phone_e164";

  if (identifierField === "phone") {
    const digits = String(identifier || "").replace(/\D/g, "");
    if (!digits) return null;
    const last10 = digits.slice(-10);
    return Client.findOne({
      organizationId,
      $or: [
        { phone_e164: { $regex: `${last10}$` } },
        { phoneNumber: { $regex: `${last10}$` } },
      ],
    })
      .select("_id name")
      .lean();
  }
  return Client.findOne({ organizationId, [dbField]: identifier }).select("_id name").lean();
}

const RESCHEDULABLE_EXCLUDED_STATUSES = [
  "cancelled",
  "cancelled_by_customer",
  "cancelled_by_admin",
];

export const rescheduleAppointment = {
  name: "reschedule_appointment",
  description:
    "Mueve una cita YA EXISTENTE (encontrada con get_my_appointments) a una nueva fecha/hora. " +
    "Úsala SOLO para reprogramar una cita que ya está agendada — nunca para crear una reserva nueva " +
    "(eso es prepare_reservation). Si el nuevo horario ya no está disponible, la tool lo rechaza; " +
    "en ese caso busca otro horario con get_available_slots y vuelve a intentarlo.",
  parameters: {
    identifier: {
      type: "string",
      description:
        "El mismo identificador (teléfono, email o documento) que se usó en get_my_appointments para encontrar la cita. Se usa para verificar que la cita pertenece a este cliente.",
      required: true,
    },
    appointmentId: {
      type: "string",
      description: "El campo 'id' exacto de la cita a mover, devuelto por get_my_appointments.",
      required: true,
    },
    newDate: {
      type: "string",
      description: "Nueva fecha en formato YYYY-MM-DD.",
      required: true,
    },
    newTime: {
      type: "string",
      description: "Nueva hora en formato HH:mm (24h). Ej: 14:30 para las 2:30 PM.",
      required: true,
    },
  },
  handler: async ({ identifier, appointmentId, newDate, newTime }, { organizationId, organization }) => {
    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      return {
        success: false,
        error: "El id de cita no es válido. Vuelve a llamar get_my_appointments para obtener el id correcto.",
      };
    }

    const client = await resolveOwnerClient(identifier, organizationId, organization);
    if (!client) {
      return { success: false, error: "No se encontró ningún cliente registrado con ese identificador." };
    }

    const appt = await Appointment.findOne({
      _id: appointmentId,
      organizationId,
      client: client._id,
    })
      .populate("service", "name")
      .populate("employee", "names");

    if (!appt) {
      return {
        success: false,
        error: "No encontré esa cita, o no pertenece a este cliente. Vuelve a llamar get_my_appointments para confirmar el id correcto.",
      };
    }
    if (RESCHEDULABLE_EXCLUDED_STATUSES.includes(appt.status)) {
      return { success: false, error: "Esa cita ya está cancelada y no se puede reprogramar." };
    }
    if (new Date(appt.startDate).getTime() < Date.now()) {
      return { success: false, error: "Esa cita ya pasó y no se puede reprogramar." };
    }

    const timezone = organization.timezone || "America/Bogota";
    const newStart = moment.tz(`${newDate}T${newTime}:00`, "YYYY-MM-DDTHH:mm:ss", timezone);
    if (!newStart.isValid()) {
      return { success: false, error: `Fecha u hora inválida: "${newDate} ${newTime}". Usa YYYY-MM-DD y HH:mm.` };
    }

    const durationMs = new Date(appt.endDate).getTime() - new Date(appt.startDate).getTime();
    const newEnd = new Date(newStart.toDate().getTime() + Math.max(durationMs, 0));

    // A diferencia del reagendado admin (que solo advierte), acá se BLOQUEA si
    // el profesional ya tiene otra cita en ese rango — un cliente por chat no
    // debería poder forzar un doble agendamiento.
    if (appt.employee) {
      const overlapping = await Appointment.findOne({
        _id: { $ne: appt._id },
        employee: appt.employee._id,
        organizationId,
        status: { $nin: RESCHEDULABLE_EXCLUDED_STATUSES },
        startDate: { $lt: newEnd },
        endDate: { $gt: newStart.toDate() },
      }).lean();

      if (overlapping) {
        return {
          success: false,
          error: "Ese horario ya no está disponible para el profesional de esta cita. Busca otro horario con get_available_slots.",
        };
      }
    }

    const fechaAnterior = moment(appt.startDate).tz(timezone).format("dddd D [de] MMMM [a las] h:mm A");
    const fechaNueva = newStart.format("dddd D [de] MMMM [a las] h:mm A");

    await appointmentService.updateAppointment(appt._id.toString(), {
      startDate: newStart.format("YYYY-MM-DDTHH:mm:ss"),
      endDate: moment(newEnd).tz(timezone).format("YYYY-MM-DDTHH:mm:ss"),
      organizationId,
    });

    return {
      success: true,
      service: appt.service?.name || "Servicio",
      professional: appt.employee?.names || "Profesional asignado",
      de: fechaAnterior,
      a: fechaNueva,
    };
  },
};
