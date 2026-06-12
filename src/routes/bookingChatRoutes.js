import { Router } from "express";
import { bookingChat, submitBookingFeedback, markBookingConverted } from "../booking-chatbot/bookingChatController.js";

const router = Router();

router.post("/", bookingChat);
router.post("/feedback", submitBookingFeedback);
router.post("/converted", markBookingConverted);

export default router;
