import { Router } from "express";
import registrationController from "../controllers/registrationController.js";
import rateLimit from "express-rate-limit";

const router = Router();

// Rate limits más estrictos para registro
// NOTA: En serverless estos contadores son por instancia (no distribuidos).
// Para production-grade: usar store de Upstash Redis / Vercel KV.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3, // 3 registros por IP por hora
  message: { error: "Demasiados intentos de registro. Intenta de nuevo en 1 hora." },
  standardHeaders: true,
  legacyHeaders: false,
});

const checkSlugLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // 10 checks por IP por minuto
  message: { error: "Demasiadas consultas. Intenta de nuevo en un momento." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Todos los endpoints son públicos (sin auth)
router.post("/register", registerLimiter, registrationController.register);
router.post("/exchange", registrationController.exchange);
router.get("/check-slug/:slug", checkSlugLimiter, registrationController.checkSlug);

export default router;
