import { Router } from "express";

import agentController from "../controllers/agentController.js";
import { verifyToken, requireSuperAdmin } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/", verifyToken, requireSuperAdmin, agentController.listAgents);
router.post("/", verifyToken, requireSuperAdmin, agentController.createAgent);
router.put("/:id", verifyToken, requireSuperAdmin, agentController.updateAgent);
router.delete("/:id", verifyToken, requireSuperAdmin, agentController.deleteAgent);
router.get("/:id/referrals", verifyToken, requireSuperAdmin, agentController.getAgentReferrals);

export default router;
