import { Router } from "express";
import rateLimit from "express-rate-limit";
import metaConversionsController from "../controllers/metaConversionsController.js";

const router = Router();

// Endpoint público (sin auth) llamado desde el navegador tras el registro;
// límite generoso pero acotado para evitar abuso del proxy hacia Graph API.
const capiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/complete-registration", capiLimiter, metaConversionsController.completeRegistration);

export default router;
