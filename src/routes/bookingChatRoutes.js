import { Router } from "express";
import { bookingChat } from "../booking-chatbot/bookingChatController.js";

const router = Router();

router.post("/", bookingChat);

export default router;
