import { Router } from "express";
import rateLimit from "express-rate-limit";
import accountAccessController from "../controllers/accountAccessController.js";

const router = Router();

// Contadores en memoria (un solo contenedor), igual que registrationRoutes.
// Además del límite por IP, el servicio limita los envíos por negocio
// (1 por minuto, 5 por hora) y los intentos por código (5).
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { message: "Demasiadas búsquedas. Espera 15 minutos e inténtalo de nuevo." },
  standardHeaders: true,
  legacyHeaders: false,
});

const sendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { message: "Pediste demasiados códigos. Espera una hora e inténtalo de nuevo." },
  standardHeaders: true,
  legacyHeaders: false,
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { message: "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/lookup", lookupLimiter, accountAccessController.lookup);
router.post("/send-code", sendLimiter, accountAccessController.sendCode);
router.post("/verify", verifyLimiter, accountAccessController.verify);
router.post("/complete", verifyLimiter, accountAccessController.complete);

export default router;
