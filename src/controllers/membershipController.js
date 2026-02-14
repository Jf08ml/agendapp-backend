// controllers/membershipController.js
import membershipService from "../services/membershipService.js";
import planModel from "../models/planModel.js";
import sendResponse from "../utils/sendResponse.js";
import { runMembershipCheck } from "../cron/membershipCheckJob.js";

const membershipController = {
  /**
   * GET /api/memberships/:organizationId/current
   * Obtener membresía activa de una organización
   */
  getCurrentMembership: async (req, res) => {
    try {
      const { organizationId } = req.params;
      const membership = await membershipService.getActiveMembership(organizationId);

      if (!membership) {
        return sendResponse(res, 404, null, "No hay membresía activa");
      }

      return sendResponse(res, 200, membership, "Membresía obtenida");
    } catch (error) {
      console.error("Error obteniendo membresía:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * POST /api/memberships
   * Crear nueva membresía
   */
  createMembership: async (req, res) => {
    try {
      const { organizationId, planId, startDate, trialDays } = req.body;

      if (!organizationId || !planId) {
        return sendResponse(res, 400, null, "organizationId y planId son requeridos");
      }

      const membership = await membershipService.createMembership({
        organizationId,
        planId,
        startDate,
        trialDays,
      });

      return sendResponse(res, 201, membership, "Membresía creada exitosamente");
    } catch (error) {
      console.error("Error creando membresía:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * POST /api/memberships/:membershipId/renew
   * Renovar membresía (registrar pago)
   */
  renewMembership: async (req, res) => {
    try {
      const { membershipId } = req.params;
      const { paymentAmount } = req.body;
      const amount = (() => {
        if (typeof paymentAmount === "number") return paymentAmount;
        if (typeof paymentAmount === "string") {
          const cleaned = paymentAmount.replace(/[^0-9.-]/g, "");
          return Number(cleaned);
        }
        return Number(paymentAmount);
      })();

      if (!Number.isFinite(amount) || amount <= 0) {
        return sendResponse(res, 400, null, "Monto de pago inválido");
      }

      const membership = await membershipService.renewMembership(membershipId, amount);

      return sendResponse(res, 200, membership, "Membresía renovada exitosamente");
    } catch (error) {
      console.error("Error renovando membresía:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * POST /api/memberships/:membershipId/suspend
   * Suspender membresía manualmente (admin)
   */
  suspendMembership: async (req, res) => {
    try {
      const { membershipId } = req.params;
      const { reason } = req.body;

      const membership = await membershipService.suspendMembership(
        membershipId,
        reason || "Suspendida por administrador"
      );

      return sendResponse(res, 200, membership, "Membresía suspendida");
    } catch (error) {
      console.error("Error suspendiendo membresía:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * POST /api/memberships/:membershipId/reactivate
   * Reactivar membresía suspendida
   */
  reactivateMembership: async (req, res) => {
    try {
      const { membershipId } = req.params;
      const { newPeriodEnd } = req.body;

      const membership = await membershipService.reactivateMembership(
        membershipId,
        newPeriodEnd ? new Date(newPeriodEnd) : null
      );

      return sendResponse(res, 200, membership, "Membresía reactivada");
    } catch (error) {
      console.error("Error reactivando membresía:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * PUT /api/memberships/:membershipId/plan
   * Cambiar plan de una membresía
   */
  changePlan: async (req, res) => {
    try {
      const { membershipId } = req.params;
      const { planId } = req.body;

      if (!planId) {
        return sendResponse(res, 400, null, "planId es requerido");
      }

      const membership = await membershipService.changePlan(membershipId, planId);

      return sendResponse(res, 200, membership, "Plan actualizado");
    } catch (error) {
      console.error("Error cambiando plan:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * GET /api/memberships
   * Listar todas las membresías (admin)
   */
  getAllMemberships: async (req, res) => {
    try {
      const { status, planId } = req.query;
      const filters = {};

      if (status) filters.status = status;
      if (planId) filters.planId = planId;

      const memberships = await membershipService.getAllMemberships(filters);

      return sendResponse(res, 200, memberships, "Membresías obtenidas");
    } catch (error) {
      console.error("Error obteniendo membresías:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * GET /api/memberships/check-access/:organizationId
   * Verificar si una organización tiene acceso activo
   */
  checkAccess: async (req, res) => {
    try {
      const { organizationId } = req.params;
      const hasAccess = await membershipService.hasActiveAccess(organizationId);

      return sendResponse(
        res,
        200,
        { hasAccess, organizationId },
        hasAccess ? "Acceso activo" : "Sin acceso activo"
      );
    } catch (error) {
      console.error("Error verificando acceso:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * PATCH /api/memberships/superadmin/:membershipId
   * Actualizar cualquier campo de una membresía (solo superadmin)
   */
  updateMembership: async (req, res) => {
    try {
      const { membershipId } = req.params;
      const updates = req.body;

      const membership = await membershipService.updateMembership(membershipId, updates);

      return sendResponse(res, 200, membership, "Membresía actualizada exitosamente");
    } catch (error) {
      console.error("Error actualizando membresía:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * POST /api/memberships/upgrade
   * Self-service: org admin solicita upgrade a plan pago.
   * Reutiliza activatePaidPlan() — la lógica central de activación.
   */
  upgrade: async (req, res) => {
    try {
      const organizationId = req.organization?._id;
      if (!organizationId) {
        return sendResponse(res, 400, null, "Organización no identificada");
      }

      const { planId } = req.body;
      if (!planId) {
        return sendResponse(res, 400, null, "planId es requerido");
      }

      const plan = await planModel.findById(planId);
      if (!plan || !plan.isActive) {
        return sendResponse(res, 404, null, "Plan no encontrado o no disponible");
      }

      // No permitir "upgrade" al plan-demo
      if (plan.slug === "plan-demo") {
        return sendResponse(res, 400, null, "No se puede seleccionar el plan demo");
      }

      const membership = await membershipService.activatePaidPlan({
        organizationId,
        planId: plan._id,
        paymentAmount: 0, // Pago manual — se registrará después
      });

      return sendResponse(res, 200, membership, "Plan activado exitosamente");
    } catch (error) {
      console.error("Error en upgrade:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * POST /api/memberships/superadmin/:membershipId/activate
   * Superadmin: Activar plan pago para una membresía (trial → active con nuevo plan).
   * Reutiliza activatePaidPlan() que resetea notificaciones, sincroniza org, etc.
   */
  activatePlan: async (req, res) => {
    try {
      const { membershipId } = req.params;
      const { planId, paymentAmount } = req.body;

      if (!planId) {
        return sendResponse(res, 400, null, "planId es requerido");
      }

      const plan = await planModel.findById(planId);
      if (!plan || !plan.isActive) {
        return sendResponse(res, 404, null, "Plan no encontrado o no disponible");
      }

      if (plan.slug === "plan-demo") {
        return sendResponse(res, 400, null, "No se puede activar el plan demo como plan pago");
      }

      // Obtener organizationId desde la membresía
      const existingMembership = await membershipService.getMembershipById(membershipId);
      if (!existingMembership) {
        return sendResponse(res, 404, null, "Membresía no encontrada");
      }

      const membership = await membershipService.activatePaidPlan({
        organizationId: existingMembership.organizationId._id || existingMembership.organizationId,
        planId: plan._id,
        paymentAmount: paymentAmount || 0,
      });

      return sendResponse(res, 200, membership, "Plan activado exitosamente");
    } catch (error) {
      console.error("Error activando plan:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * POST /api/cron/check-memberships
   * Ejecutar verificación manual de membresías (para testing o cron externo)
   */
  runMembershipCheckManual: async (req, res) => {
    try {
      const result = await runMembershipCheck();
      return sendResponse(res, 200, result, "Verificación completada");
    } catch (error) {
      console.error("Error en verificación manual:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },
};

export default membershipController;
