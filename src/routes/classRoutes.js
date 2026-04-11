// src/routes/classRoutes.js
import express from "express";
import { roomController, classController, sessionController } from "../controllers/classController.js";
import { verifyToken, optionalAuth } from "../middleware/authMiddleware.js";
import { organizationResolver } from "../middleware/organizationResolver.js";
import { requireActiveMembership } from "../middleware/membershipMiddleware.js";

const router = express.Router();

// ════════════════════════════════════════════════
// SALONES
// ════════════════════════════════════════════════

// 🌐 Público: listar salones de una organización
router.get("/rooms/organization/:organizationId", roomController.getByOrganization);

// 🔒 Protegido: CRUD de salones
router.post(
  "/rooms",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  roomController.create
);
router.get(
  "/rooms",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  roomController.getByOrganization
);
router.get(
  "/rooms/:id",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  roomController.getById
);
router.put(
  "/rooms/:id",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  roomController.update
);
router.delete(
  "/rooms/:id",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  roomController.delete
);

// ════════════════════════════════════════════════
// SESIONES
// IMPORTANTE: deben ir ANTES de las rutas /:id de clases
// para que GET /sessions no sea capturado por GET /:id
// ════════════════════════════════════════════════

// 🌐 Público: sesiones disponibles para reserva (por organizationId en query)
router.get("/sessions/available", sessionController.getAvailable);

// 🔒 Generación masiva de sesiones recurrentes
router.post(
  "/sessions/bulk",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  sessionController.bulkCreate
);

// 🔒 Protegido: CRUD de sesiones
router.post(
  "/sessions",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  sessionController.create
);
router.get(
  "/sessions",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  sessionController.getByOrganization
);
router.get(
  "/sessions/:id",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  sessionController.getById
);
router.put(
  "/sessions/:id",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  sessionController.update
);
router.delete(
  "/sessions/:id",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  sessionController.delete
);
router.post(
  "/sessions/bulk-delete",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  sessionController.bulkDelete
);
router.patch(
  "/sessions/:id/cancel",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  sessionController.cancel
);
router.patch(
  "/sessions/:id/complete",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  sessionController.markCompleted
);

// ════════════════════════════════════════════════
// CLASES (tipos de clase)
// IMPORTANTE: /:id va al final para no capturar /sessions ni /rooms
// ════════════════════════════════════════════════

// 🌐 Público: clases activas de una organización (para landing/reserva online)
router.get("/organization/:organizationId", classController.getByOrganization);

// 🔒 Protegido: CRUD de tipos de clase
router.post(
  "/",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  classController.create
);
router.get(
  "/",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  classController.getByOrganization
);
// ⚠️ /:id siempre al final — captura cualquier segmento único no cubierto arriba
router.get(
  "/:id",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  classController.getById
);
router.put(
  "/:id",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  classController.update
);
router.delete(
  "/:id",
  organizationResolver,
  verifyToken,
  requireActiveMembership,
  classController.delete
);

export default router;
