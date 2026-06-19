import { Router } from "express";
import { verifyToken, requireSuperAdmin } from "../middleware/authMiddleware.js";
import {
  adminGetAll,
  adminCreate,
  adminUpdate,
  adminDelete,
  adminTogglePublish,
} from "../controllers/announcementController.js";

const router = Router();

// verifyToken pone req.user (que requireSuperAdmin necesita); sin él → 401 siempre.
router.use(verifyToken, requireSuperAdmin);

router.get("/", adminGetAll);
router.post("/", adminCreate);
router.put("/:id", adminUpdate);
router.delete("/:id", adminDelete);
router.patch("/:id/publish", adminTogglePublish);

export default router;
