import { Router } from "express";
import { verifyToken, requireSuperAdmin } from "../middleware/authMiddleware.js";
import { getConversations, getMessages, markRead, postReply } from "../controllers/platformInboxController.js";

const router = Router();

// Inbox del número de plataforma de WhatsApp (retargeting + respuestas) — solo superadmin.
router.use(verifyToken, requireSuperAdmin);

router.get("/conversations", getConversations);
router.get("/conversations/:phone/messages", getMessages);
router.patch("/conversations/:phone/read", markRead);
router.post("/conversations/:phone/reply", postReply);

export default router;
