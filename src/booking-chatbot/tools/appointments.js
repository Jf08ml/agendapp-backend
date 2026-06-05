import moment from "moment-timezone";
import Client from "../../models/clientModel.js";
import Appointment from "../../models/appointmentModel.js";

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
        "Valor del identificador del cliente: teléfono en formato E.164 (ej: +573001234567), " +
        "email, o número de documento — según lo que configure el negocio.",
      required: true,
    },
  },
  handler: async ({ identifier }, { organizationId, organization }) => {
    const identifierField =
      organization.clientFormConfig?.identifierField || "phone";
    const dbField = IDENTIFIER_FIELD_MAP[identifierField] || "phone_e164";

    const client = await Client.findOne({
      organizationId,
      [dbField]: identifier,
    })
      .select("_id name")
      .lean();

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
