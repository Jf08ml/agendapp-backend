import { Router } from "express";
import { verifyToken, requireSuperAdmin } from "../middleware/authMiddleware.js";
import { adminGetAll, adminUpdateStatus } from "../controllers/featureRequestController.js";

const router = Router();

// verifyToken pone req.user (que requireSuperAdmin necesita); sin él → 401 siempre.
router.use(verifyToken, requireSuperAdmin);

router.get("/", adminGetAll);
router.patch("/:id", adminUpdateStatus);

export default router;
