import { Router } from "express";
import { oficinaSignature } from "../middleware/oficinaSignature.js";
import { getMessages, getOrganizations, postDeliveryStatus, postOptOut, postSend } from "../controllers/oficinaOutreachController.js";

// AgenditApp Oficina IA → backend (trabajador de activación). Llamadas entre
// servidores firmadas con HMAC (OFICINA_API_SECRET); sin cookies ni JWT.
const router = Router();

router.use(oficinaSignature);
router.get("/organizations", getOrganizations);
router.get("/organizations/:id/messages", getMessages);
router.post("/organizations/:id/opt-out", postOptOut);
router.post("/send", postSend);
router.post("/delivery-status", postDeliveryStatus);

export default router;
