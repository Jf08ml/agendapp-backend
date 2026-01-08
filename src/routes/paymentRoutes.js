// routes/paymentRoutes.js
import express from "express";
import paymentController from "../controllers/paymentController.js";

const router = express.Router();

// Crear link de checkout
router.post("/checkout", paymentController.createCheckout);

// Webhook de proveedor (Polar)
router.post("/webhook", express.raw({ type: "application/json" }), paymentController.webhook);

// Verificar sesión/checkout (opcional: frontend puede consultar)
router.get("/verify", paymentController.verify);

// Historial y sesiones
router.get("/history", paymentController.listHistory);
router.get("/sessions", paymentController.listSessions);

// Registro manual de pago (superadmin)
router.post("/manual-payment", paymentController.createManualPayment);

export default router;
