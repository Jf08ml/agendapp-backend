// middleware/membershipMiddleware.js
import membershipService from "../services/membershipService.js";
import organizationModel from "../models/organizationModel.js";

/**
 * Middleware para verificar que la organización tenga una membresía activa
 * Bloquea el acceso si la membresía está suspendida o vencida
 */
export const requireActiveMembership = async (req, res, next) => {
  try {
    // Si la ruta es de autenticación, planes públicos o cron, permitir
    const publicPaths = ["/auth", "/plans/public", "/cron", "/public"];
    if (publicPaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    // Obtener organizationId del request (puede venir de diferentes lugares)
    let organizationId = req.organization?._id || req.user?.organizationId || req.params.organizationId;

    if (!organizationId) {
      // Si no hay organizationId, continuar (será manejado por otros middlewares)
      return next();
    }

    // Verificar estado de la organización
    const org = await organizationModel.findById(organizationId);
    
    if (!org) {
      return res.status(404).json({
        success: false,
        message: "Organización no encontrada",
      });
    }

    // Si el acceso está bloqueado
    if (org.hasAccessBlocked) {
      return res.status(403).json({
        success: false,
        message: "Acceso suspendido. Tu membresía ha vencido. Por favor, renueva tu plan para continuar.",
        reason: "membership_suspended",
        data: {
          membershipStatus: org.membershipStatus,
          currentMembershipId: org.currentMembershipId,
        },
      });
    }

    // Verificar membresía activa
    const hasAccess = await membershipService.hasActiveAccess(organizationId);
    
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "No tienes una membresía activa. Por favor, activa un plan para continuar.",
        reason: "no_active_membership",
        data: {
          membershipStatus: org.membershipStatus,
        },
      });
    }

    // Todo bien, continuar
    next();
  } catch (error) {
    console.error("Error en middleware de membresía:", error);
    // En caso de error, permitir el acceso (fail-safe) pero loguear el error
    next();
  }
};

/**
 * Middleware opcional que adjunta información de membresía al request
 * No bloquea, solo añade información
 */
export const attachMembershipInfo = async (req, res, next) => {
  try {
    const organizationId = req.organization?._id || req.user?.organizationId || req.params.organizationId;

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
 * Middleware para verificar límites específicos del plan
 * Ejemplo: checkPlanLimit('maxEmployees', currentCount)
 */
export const checkPlanLimit = (limitKey) => {
  return async (req, res, next) => {
    try {
      if (!req.membership || !req.membership.planId?.limits) {
        return next(); // Si no hay membresía o límites, permitir (para no romper funcionalidad existente)
      }

      const limit = req.membership.planId.limits[limitKey];
      
      // Si el límite es null, es ilimitado
      if (limit === null || limit === undefined) {
        return next();
      }

      // El límite se debe verificar en el controller específico
      // Este middleware solo adjunta el límite al request
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
