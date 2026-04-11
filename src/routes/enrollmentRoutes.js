// src/routes/enrollmentRoutes.js
import express from "express";
import enrollmentController from "../controllers/enrollmentController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { organizationResolver } from "../middleware/organizationResolver.js";
import { requireActiveMembership } from "../middleware/membershipMiddleware.js";

const router = express.Router();

// ════════════════════════════════════════════════
// PÚBLICO
// ════════════════════════════════════════════════

// Cliente reserva desde la web (sin auth)
router.post("/public", enrollmentController.createPublic);

// ════════════════════════════════════════════════
// PROTEGIDO (admin)
// ════════════════════════════════════════════════

// Admin crea inscripción directamente
router.post(
  "/",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  enrollmentController.adminCreate
);

// Listar inscripciones de la organización
router.get(
  "/",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  enrollmentController.getByOrganization
);

// Inscripciones de una sesión específica
router.get(
  "/session/:sessionId",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  enrollmentController.getBySession
);

// Aprobar inscripción pendiente
router.patch(
  "/:id/approve",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  enrollmentController.approve
);

// Cancelar inscripción
router.patch(
  "/:id/cancel",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  enrollmentController.cancel
);

// Marcar asistencia
router.patch(
  "/:id/attendance",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  enrollmentController.updateAttendance
);

// Registrar pago
router.post(
  "/:id/payments",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  enrollmentController.addPayment
);

export default router;
