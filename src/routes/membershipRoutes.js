// routes/membershipRoutes.js
import { Router } from "express";
import membershipController from "../controllers/membershipController.js";
import { verifyToken, requireSuperAdmin } from "../middleware/authMiddleware.js";
import { organizationResolver } from "../middleware/organizationResolver.js";

const router = Router();

// 🌐 Rutas PÚBLICAS (sin autenticación) - Para verificar membresía en carga inicial
router.get("/:organizationId/current", membershipController.getCurrentMembership);
router.get("/check-access/:organizationId", membershipController.checkAccess);

// 🔒 Rutas PROTEGIDAS (requieren autenticación)
// El negocio solo consulta y mejora SU plan (my-plan-info, upgrade). Listar,
// crear, renovar, suspender, reactivar o cambiar el plan de cualquier membresía
// es del superadmin: antes bastaba cualquier sesión.
router.get("/my-plan-info", organizationResolver, verifyToken, membershipController.getMyPlanInfo);
router.post("/upgrade", organizationResolver, verifyToken, membershipController.upgrade);
router.post("/", verifyToken, requireSuperAdmin, membershipController.createMembership);
router.post("/:membershipId/renew", verifyToken, requireSuperAdmin, membershipController.renewMembership);
router.post("/:membershipId/suspend", verifyToken, requireSuperAdmin, membershipController.suspendMembership);
router.post("/:membershipId/reactivate", verifyToken, requireSuperAdmin, membershipController.reactivateMembership);
router.put("/:membershipId/plan", verifyToken, requireSuperAdmin, membershipController.changePlan);
router.get("/", verifyToken, requireSuperAdmin, membershipController.getAllMemberships);

// Rutas de superadmin
router.patch("/superadmin/:membershipId", verifyToken, requireSuperAdmin, membershipController.updateMembership);
router.post("/superadmin/:membershipId/activate", verifyToken, requireSuperAdmin, membershipController.activatePlan);

export default router;
