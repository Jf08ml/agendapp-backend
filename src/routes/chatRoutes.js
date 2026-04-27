import { Router } from "express";
import { chat } from "../chatbot/chatController.js";

const router = Router();

router.post("/", chat);

export default router;
