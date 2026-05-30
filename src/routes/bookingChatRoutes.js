import { Router } from "express";
import { bookingChat, submitBookingFeedback } from "../booking-chatbot/bookingChatController.js";

const router = Router();

router.post("/", bookingChat);
router.post("/feedback", submitBookingFeedback);

export default router;
