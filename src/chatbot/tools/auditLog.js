import AuditLog from "../../models/auditLogModel.js";
import moment from "moment-timezone";

const ENTITY_LABELS = {
  appointment: "cita",
  client: "cliente",
  employee: "profesional",
  reservation: "reserva",
};

export default [
  {
    name: "get_recent_deletions",
    description:
      "Consulta el historial de eliminaciones (citas, clientes, profesionales o reservas borrados) — la misma información de la página Historial de eliminaciones. Úsala cuando el usuario pregunte quién eliminó algo, o qué se ha borrado recientemente.",
    parameters: {
      entityType: { type: "string", description: "Filtrar por tipo: 'appointment', 'client', 'employee' o 'reservation'. Opcional.", required: false },
      limit: { type: "number", description: "Máximo de registros a devolver (por defecto 15).", required: false },
    },
    handler: async (params, context) => {
      const tz = context.organization.timezone || "America/Bogota";
      const filter = { organizationId: context.organizationId };
      if (params.entityType) filter.entityType = params.entityType;

      const logs = await AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .limit(params.limit || 15)
        .lean();

      if (logs.length === 0) {
        return { success: true, found: false, message: "No hay eliminaciones registradas con esos filtros." };
      }

      return {
        success: true,
        total: logs.length,
        eliminaciones: logs.map((l) => ({
          tipo: ENTITY_LABELS[l.entityType] || l.entityType,
          detalle: l.entitySnapshot?.name || l.entitySnapshot?.clientName || l.entitySnapshot?.serviceName || l.entitySnapshot?.customerName || null,
          eliminadoPor: l.performedByName || "Sistema",
          fecha: moment(l.createdAt).tz(tz).format("DD/MM/YYYY [a las] HH:mm"),
        })),
      };
    },
  },
];
