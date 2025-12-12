// routes/membershipRoutes.js
import { Router } from "express";
import membershipController from "../controllers/membershipController.js";

const router = Router();

// Rutas públicas/organizaciones
router.get("/:organizationId/current", membershipController.getCurrentMembership);
router.get("/check-access/:organizationId", membershipController.checkAccess);

// Rutas administrativas (requieren autenticación de admin)
router.post("/", membershipController.createMembership);
router.post("/:membershipId/renew", membershipController.renewMembership);
router.post("/:membershipId/suspend", membershipController.suspendMembership);
router.post("/:membershipId/reactivate", membershipController.reactivateMembership);
router.put("/:membershipId/plan", membershipController.changePlan);
router.get("/", membershipController.getAllMemberships);

// Rutas de superadmin
router.patch("/superadmin/:membershipId", membershipController.updateMembership);

export default router;
