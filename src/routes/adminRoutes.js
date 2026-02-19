import { Router } from "express";
import rateLimit from "express-rate-limit";

import adminController from "../controllers/adminController.js";
import { verifyToken, requireSuperAdmin } from "../middleware/authMiddleware.js";

const router = Router();

// ─── Rate limits ────────────────────────────────────────────────────────────

/** Login: 5 intentos por IP cada 15 minutos */
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Demasiados intentos de login. Intenta de nuevo en 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Impersonate: 30 por hora por IP.
 * NOTA: En serverless estos contadores son por instancia.
 * Para producción crítica: usar Upstash Redis / Vercel KV como store.
 */
const impersonateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: "Límite de impersonaciones alcanzado. Intenta en 1 hora." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Rutas ──────────────────────────────────────────────────────────────────

/** Autenticación de superadmin (sin auth previa, protegido solo por rate limit) */
router.post("/admin/login", adminLoginLimiter, adminController.login);

/** Crear impersonation code (requiere JWT de superadmin) */
router.post(
  "/admin/impersonate",
  impersonateLimiter,
  verifyToken,
  requireSuperAdmin,
  adminController.impersonate
);

/** Listar auditorías (solo superadmins) */
router.get(
  "/admin/impersonations",
  verifyToken,
  requireSuperAdmin,
  adminController.listAudits
);

export default router;
