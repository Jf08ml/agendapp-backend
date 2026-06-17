import express from "express";
import { mpOauthCallback, mpWebhook, getOrderStatus } from "../controllers/collectionController.js";

// Rutas públicas de Mercado Pago (sin auth). Montadas bajo /mp.
// - oauth/callback: redirección del OAuth (org identificada por el `state` firmado).
// - webhook: notificación de pagos (org vía ?org=, validada por x-signature).
// - order/:ref: polling de estado del Order desde la pantalla de retorno.
const router = express.Router();

router.get("/oauth/callback", mpOauthCallback);
router.post("/webhook", mpWebhook);
router.get("/order/:externalReference", getOrderStatus);

export default router;
