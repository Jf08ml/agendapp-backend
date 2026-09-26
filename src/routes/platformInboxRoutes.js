import { Router } from "express";
import { verifyToken, requireSuperAdmin } from "../middleware/authMiddleware.js";
import {
  getConversations,
  getMessages,
  markRead,
  postReply,
  getSettings,
  patchSettings,
} from "../controllers/platformInboxController.js";

const router = Router();

// Inbox del número de plataforma de WhatsApp (retargeting + respuestas) — solo superadmin.
router.use(verifyToken, requireSuperAdmin);

// Interruptores de envíos automáticos por el número de plataforma.
router.get("/settings", getSettings);
router.patch("/settings", patchSettings);

router.get("/conversations", getConversations);
router.get("/conversations/:phone/messages", getMessages);
router.patch("/conversations/:phone/read", markRead);
router.post("/conversations/:phone/reply", postReply);

export default router;
