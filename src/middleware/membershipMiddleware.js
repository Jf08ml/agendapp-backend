// middleware/membershipMiddleware.js
import membershipService from "../services/membershipService.js";
import organizationModel from "../models/organizationModel.js";

/**
 * Middleware para verificar que la organización tenga una membresía activa.
 * Usa getCurrentMembership (trae la vigente sin importar estado) y decide:
 *   - TRIAL / ACTIVE → acceso full
 *   - PAST_DUE → solo lectura (GET/HEAD/OPTIONS)
 *   - SUSPENDED / CANCELLED / EXPIRED → sin acceso
 *   - Sin membresía → sin acceso
 *
 * Fail-secure: en caso de error interno, bloquea con 403.
 */
export const requireActiveMembership = async (req, res, next) => {
  try {
    const organizationId =
      req.organization?._id || req.user?.organizationId || req.params.organizationId;

    if (!organizationId) {
      // Sin organizationId → otros middlewares lo manejan
      return next();
    }

    // Buscar la membresía más reciente (cualquier estado relevante)
    const membership = await membershipService.getCurrentMembership(organizationId);

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: "No tienes una membresía activa. Por favor, activa un plan para continuar.",
        reason: "no_active_membership",
      });
    }

    const { status } = membership;

    // TRIAL / ACTIVE → acceso completo
    if (status === "active" || status === "trial") {
      return next();
    }

    // PAST_DUE → solo lectura
    if (status === "past_due") {
      const readOnlyMethods = ["GET", "HEAD", "OPTIONS"];
      if (readOnlyMethods.includes(req.method)) {
        return next();
      }
      return res.status(403).json({
        success: false,
        message: "Tu plan ha vencido. Renueva para poder crear o modificar datos.",
        reason: "membership_past_due",
        data: {
          membershipStatus: "past_due",
          currentPeriodEnd: membership.currentPeriodEnd,
        },
      });
    }

    // SUSPENDED / CANCELLED / EXPIRED → sin acceso
    return res.status(403).json({
      success: false,
      message: "Acceso suspendido. Tu membresía ha vencido. Por favor, renueva tu plan.",
      reason: "membership_suspended",
      data: {
        membershipStatus: status,
      },
    });
  } catch (error) {
    console.error("Error en middleware de membresía:", error);
    // Fail-secure: bloquear acceso en caso de error
    return res.status(403).json({
      success: false,
      message: "No se pudo verificar tu membresía. Intenta de nuevo.",
      reason: "membership_check_failed",
    });
  }
};

/**
 * Middleware opcional que adjunta información de membresía al request.
 * No bloquea, solo añade información.
 */
export const attachMembershipInfo = async (req, res, next) => {
  try {
    const organizationId =
      req.organization?._id || req.user?.organizationId || req.params.organizationId;

    if (organizationId) {
      const membership = await membershipService.getActiveMembership(organizationId);
      if (membership) {
        req.membership = membership;
        req.membershipLimits = membership.planId?.limits || {};
      }
    }

    next();
  } catch (error) {
    console.error("Error adjuntando información de membresía:", error);
    next();
  }
};

/**
 * Middleware para verificar límites específicos del plan.
 * Ejemplo: checkPlanLimit('maxEmployees')
 */
export const checkPlanLimit = (limitKey) => {
  return async (req, res, next) => {
    try {
      if (!req.membership || !req.membership.planId?.limits) {
        return next();
      }

      const limit = req.membership.planId.limits[limitKey];

      // null = ilimitado
      if (limit === null || limit === undefined) {
        return next();
      }

      req.planLimit = limit;
      next();
    } catch (error) {
      console.error(`Error verificando límite ${limitKey}:`, error);
      next();
    }
  };
};

export default {
  requireActiveMembership,
  attachMembershipInfo,
  checkPlanLimit,
};
