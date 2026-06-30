// src/routes/impactSurveyRoutes.js
import { Router } from "express";
import impactSurveyController from "../controllers/impactSurveyController.js";
import { requireAdmin } from "../middleware/authMiddleware.js";

// Montado con organizationResolver + verifyToken en indexRoutes (grupo "auth, sin
// chequeo de membresía"). requireAdmin se aplica por-ruta: solo el admin de la org
// ve y responde su reporte de impacto.
const router = Router();

router.get("/me", requireAdmin, impactSurveyController.getMine);
router.post("/respond", requireAdmin, impactSurveyController.respond);
router.post("/snooze", requireAdmin, impactSurveyController.snooze);

export default router;
