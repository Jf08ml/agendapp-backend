// routes/membershipRoutes.js
import { Router } from "express";
import membershipController from "../controllers/membershipController.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = Router();

// 🌐 Rutas PÚBLICAS (sin autenticación) - Para verificar membresía en carga inicial
router.get("/:organizationId/current", membershipController.getCurrentMembership);
router.get("/check-access/:organizationId", membershipController.checkAccess);

// 🔒 Rutas PROTEGIDAS (requieren autenticación)
router.post("/", verifyToken, membershipController.createMembership);
router.post("/:membershipId/renew", verifyToken, membershipController.renewMembership);
router.post("/:membershipId/suspend", verifyToken, membershipController.suspendMembership);
router.post("/:membershipId/reactivate", verifyToken, membershipController.reactivateMembership);
router.put("/:membershipId/plan", verifyToken, membershipController.changePlan);
router.get("/", verifyToken, membershipController.getAllMemberships);

// Rutas de superadmin
router.patch("/superadmin/:membershipId", verifyToken, membershipController.updateMembership);

export default router;
