import express from "express";
import sessionController from "../controllers/sessionController.js";
import { requireAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * Rutas para ver/cerrar sesiones activas (dispositivos logueados) del equipo
 * de una organización. Montadas bajo /organizations (ver indexRoutes.js).
 *
 * requireOwnOrganization sigue el mismo patrón que whatsappTemplateRoutes.js
 * (fix de IDOR 2026-08-20): el :id de la URL debe coincidir con la org
 * resuelta por organizationResolver, si no se rechaza.
 */
function requireOwnOrganization(req, res, next) {
  if (!req.organization || String(req.organization._id) !== req.params.id) {
    return res.status(403).json({
      result: "error",
      message: "No tienes acceso a esta organización",
    });
  }
  next();
}

// Solo la cuenta admin de la org puede ver/cerrar sesiones — incluye las de
// sus empleados, no solo las propias.
router.get("/:id/sessions", requireOwnOrganization, requireAdmin, sessionController.listSessions);
router.delete(
  "/:id/sessions/:sessionId",
  requireOwnOrganization,
  requireAdmin,
  sessionController.revokeSession
);

export default router;
