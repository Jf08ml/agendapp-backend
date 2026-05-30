import { Router } from "express";
import { chat, submitFeedback } from "../chatbot/chatController.js";

const router = Router();

router.post("/", chat);
router.post("/feedback", submitFeedback);

export default router;
