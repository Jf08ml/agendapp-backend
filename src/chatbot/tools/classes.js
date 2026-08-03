import { sessionService } from "../../services/classService.js";
import moment from "moment-timezone";

export default [
  {
    name: "get_upcoming_class_sessions",
    description:
      "Lista las próximas sesiones de clases grupales programadas, con su cupo disponible. Úsala cuando el usuario pregunte por las próximas clases, cuántos cupos quedan, o qué clases hay programadas.",
    parameters: {
      dateFrom: { type: "string", description: "Fecha desde (YYYY-MM-DD). Por defecto hoy.", required: false },
      dateTo: { type: "string", description: "Fecha hasta (YYYY-MM-DD). Por defecto sin límite (las próximas 20).", required: false },
    },
    handler: async (params, context) => {
      const tz = context.organization.timezone || "America/Bogota";
      const from = params.dateFrom ? moment.tz(params.dateFrom, "YYYY-MM-DD", tz).startOf("day").toDate() : undefined;
      const to = params.dateTo ? moment.tz(params.dateTo, "YYYY-MM-DD", tz).endOf("day").toDate() : undefined;

      const sessions = await sessionService.getAvailable(context.organizationId, { from, to });
      const limited = sessions.slice(0, 20);

      if (limited.length === 0) {
        return { success: true, found: false, message: "No hay sesiones de clase programadas con cupo disponible en ese rango." };
      }

      return {
        success: true,
        total: limited.length,
        sesiones: limited.map((s) => ({
          id: s._id,
          clase: s.classId?.name || "?",
          instructor: s.employeeId?.names || "?",
          sala: s.roomId?.name || "?",
          fecha: moment(s.startDate).tz(tz).format("DD/MM/YYYY [a las] HH:mm"),
          cupoTotal: s.capacity,
          inscritos: s.enrolledCount,
          cupoDisponible: Math.max(0, s.capacity - s.enrolledCount),
          precioPorPersona: s.classId?.pricePerPerson ?? null,
        })),
      };
    },
  },
];
