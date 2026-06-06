import { Router } from "express";
import { requireSuperAdmin } from "../middleware/authMiddleware.js";
import {
  adminGetAll,
  adminCreate,
  adminUpdate,
  adminDelete,
  adminTogglePublish,
} from "../controllers/announcementController.js";

const router = Router();

router.use(requireSuperAdmin);

router.get("/", adminGetAll);
router.post("/", adminCreate);
router.put("/:id", adminUpdate);
router.delete("/:id", adminDelete);
router.patch("/:id/publish", adminTogglePublish);

export default router;
