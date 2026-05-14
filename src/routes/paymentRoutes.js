// routes/paymentRoutes.js
import { Router } from "express";
import paymentController from "../controllers/paymentController.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = Router();

// Webhooks de PayPal (público — PayPal valida firma internamente)
router.post("/webhook/:provider", paymentController.handleWebhook);

// PayPal SDK: el frontend avisa después de que el usuario aprueba
router.post("/paypal/subscription-created", verifyToken, paymentController.subscriptionCreated);
router.post("/paypal/order-captured", verifyToken, paymentController.orderCaptured);

// Manual
router.post("/checkout", verifyToken, paymentController.createCheckout);
router.post("/manual-confirm", verifyToken, paymentController.confirmManualPayment);
router.get("/history/:organizationId", verifyToken, paymentController.getPaymentHistory);

// Superadmin: diagnóstico de configuración PayPal
router.get("/paypal/diagnose", verifyToken, paymentController.diagnosePaypal);

// Superadmin: renovación manual por subscriptionId (para webhooks perdidos)
router.post("/paypal/renew-by-subscription", verifyToken, paymentController.renewBySubscription);

// Superadmin: sync activo de suscripciones PayPal (safety net para webhooks perdidos)
router.post("/paypal/sync-subscriptions", verifyToken, paymentController.syncPaypalSubscriptions);

export default router;
