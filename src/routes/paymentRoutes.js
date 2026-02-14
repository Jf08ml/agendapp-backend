// routes/paymentRoutes.js
import { Router } from "express";
import paymentController from "../controllers/paymentController.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = Router();

// Webhooks (público, sin auth — el provider valida firma internamente)
router.post("/webhook/:provider", paymentController.handleWebhook);

// Checkout y manual confirm (protegidos con auth)
router.post("/checkout", verifyToken, paymentController.createCheckout);
router.post("/manual-confirm", verifyToken, paymentController.confirmManualPayment);
router.get("/history/:organizationId", verifyToken, paymentController.getPaymentHistory);

export default router;
