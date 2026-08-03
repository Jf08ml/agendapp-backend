import membershipService from "../../services/membershipService.js";
import moment from "moment-timezone";

const STATUS_LABELS = {
  active: "activa",
  trial: "en periodo de prueba",
  pending: "pendiente de activación",
  past_due: "vencida (en periodo de gracia)",
  suspended: "suspendida",
  cancelled: "cancelada",
  expired: "expirada",
};

export default [
  {
    name: "get_membership_status",
    description:
      "Consulta el estado de la membresía/plan actual del negocio: plan contratado, estado, cuándo vence o cuántos días de prueba quedan, y los límites/funciones incluidas en el plan. Úsala cuando el usuario pregunte por su plan, su membresía, cuánto le queda de prueba, o qué incluye su plan.",
    parameters: {},
    handler: async (_params, context) => {
      const membership = await membershipService.getCurrentMembership(context.organizationId);
      if (!membership) {
        return { success: true, found: false, message: "No se encontró información de membresía para este negocio." };
      }

      const tz = context.organization.timezone || "America/Bogota";
      const now = moment.tz(tz);
      const referenceEnd = membership.status === "trial" ? membership.trialEnd : membership.currentPeriodEnd;
      const daysLeft = referenceEnd ? Math.ceil(moment(referenceEnd).tz(tz).diff(now, "hours") / 24) : null;

      const plan = membership.planId;
      return {
        success: true,
        plan: plan?.name || "Sin plan asignado",
        estado: STATUS_LABELS[membership.status] || membership.status,
        vence: referenceEnd ? moment(referenceEnd).tz(tz).format("DD/MM/YYYY") : null,
        diasRestantes: daysLeft,
        autoRenueva: !!membership.autoRenew,
        limites: plan?.limits
          ? {
              maxProfesionales: plan.limits.maxEmployees ?? "ilimitado",
              maxServicios: plan.limits.maxServices ?? "ilimitado",
              maxCitasPorMes: plan.limits.maxAppointmentsPerMonth ?? "ilimitado",
              integracionWhatsapp: !!plan.limits.whatsappIntegration,
              moduloClases: !!plan.limits.classesModule,
              paquetesDeSesiones: !!plan.limits.servicePackages,
              campanasWhatsapp: !!plan.limits.campaignsWhatsapp,
              programaFidelidad: !!plan.limits.loyaltyProgram,
            }
          : null,
      };
    },
  },
];
