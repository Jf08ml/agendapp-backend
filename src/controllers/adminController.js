import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import AdminUser from "../models/adminUserModel.js";
import Organization from "../models/organizationModel.js";
import ExchangeCode from "../models/exchangeCodeModel.js";
import ImpersonationAudit from "../models/impersonationAuditModel.js";
import sendResponse from "../utils/sendResponse.js";

/** TTL del ExchangeCode de impersonación (90 segundos) */
const IMPERSONATION_CODE_TTL_MS = 90 * 1000;

/** Duración del JWT resultante cuando es impersonación (60 minutos) */
const IMPERSONATION_JWT_TTL = "60m";

/**
 * Extrae la IP real del request, considerando proxies/Vercel.
 */
function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

const adminController = {
  /**
   * POST /api/admin/login
   * Autenticación de superadmin (AdminUser, independiente de Organization).
   * Retorna JWT con userType: 'superadmin' y adminId.
   */
  login: async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return sendResponse(res, 400, null, "Email y password requeridos");
      }

      const admin = await AdminUser.findOne({ email: email.toLowerCase().trim() });

      // Respuesta genérica para no revelar si el email existe
      if (!admin || !admin.isActive) {
        return sendResponse(res, 401, null, "Credenciales inválidas");
      }

      const isValid = await bcrypt.compare(password, admin.passwordHash);
      if (!isValid) {
        return sendResponse(res, 401, null, "Credenciales inválidas");
      }

      const token = jwt.sign(
        {
          adminId: admin._id.toString(),
          userType: "superadmin",
        },
        process.env.JWT_SECRET,
        { expiresIn: "8h" }
      );

      console.log(`[admin/login] SuperAdmin ${admin.email} autenticado desde ${getClientIp(req)}`);

      sendResponse(res, 200, {
        token,
        adminId: admin._id,
        name: admin.name,
        userType: "superadmin",
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      }, "Login de superadmin exitoso");
    } catch (error) {
      console.error("[admin/login] Error:", error);
      sendResponse(res, 500, null, "Error en login de superadmin");
    }
  },

  /**
   * POST /api/admin/impersonate
   * Genera un ExchangeCode de un solo uso para acceder como una Organization.
   *
   * Body:
   *   organizationId?: string  — ID de la organización (alternativo a slug)
   *   slug?:           string  — Slug de la organización (alternativo a organizationId)
   *   reason:          string  — Razón obligatoria (mínimo 5 chars, se guarda en auditoría)
   *
   * Response:
   *   exchangeCode:    string  — Código de un solo uso, caduca en 90s
   *   subdomain:       string  — "{slug}.agenditapp.com"
   *   organizationId:  string
   *   expiresIn:       number  — Segundos hasta que expira el code
   */
  impersonate: async (req, res) => {
    try {
      const { organizationId, slug, reason } = req.body;
      const adminId = req.user.adminId;

      // ── Validaciones de entrada ──────────────────────────────────────────
      if (!reason || reason.trim().length < 5) {
        return sendResponse(res, 400, null, "La razón es obligatoria (mínimo 5 caracteres)");
      }

      if (!organizationId && !slug) {
        return sendResponse(res, 400, null, "Debes proporcionar organizationId o slug");
      }

      // Validar formato de organizationId si se proporcionó
      if (organizationId && !mongoose.isValidObjectId(organizationId)) {
        return sendResponse(res, 400, null, "organizationId inválido");
      }

      // ── Buscar organización ──────────────────────────────────────────────
      const query = organizationId
        ? { _id: organizationId }
        : { slug: slug.toLowerCase().trim() };

      const org = await Organization.findOne(query)
        .select("_id slug name email isActive")
        .lean();

      if (!org) {
        return sendResponse(res, 404, null, "Organización no encontrada");
      }

      // ── Obtener datos del admin para auditoría ───────────────────────────
      const admin = await AdminUser.findById(adminId).select("email name").lean();
      if (!admin) {
        // Esto no debería ocurrir si requireSuperAdmin funcionó bien
        return sendResponse(res, 403, null, "SuperAdmin no encontrado");
      }

      // ── Crear ExchangeCode con TTL corto ─────────────────────────────────
      const code = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + IMPERSONATION_CODE_TTL_MS);

      await new ExchangeCode({
        code,
        userId: org._id,
        organizationId: org._id,
        role: "admin",
        expiresAt,
        impersonatedBy: adminId,
        impersonationReason: reason.trim(),
      }).save();

      // ── Guardar auditoría (no bloquear respuesta si falla) ───────────────
      try {
        await ImpersonationAudit.create({
          adminUserId: adminId,
          adminEmail: admin.email,
          targetOrganizationId: org._id,
          targetSlug: org.slug,
          reason: reason.trim(),
          ip: getClientIp(req),
          userAgent: req.headers["user-agent"] || "unknown",
        });
      } catch (auditError) {
        // Si falla la auditoría, loguear pero NO cancelar el flujo
        // Un fallo de auditoría no debe bloquear el acceso legítimo del superadmin
        console.error("[admin/impersonate] WARN: falló auditoría:", auditError.message);
      }

      console.log(
        `[IMPERSONATION] ✓ ${admin.email} → org "${org.slug}" (${org._id}) | Razón: ${reason.trim()} | IP: ${getClientIp(req)}`
      );

      sendResponse(res, 200, {
        exchangeCode: code,
        subdomain: `${org.slug}.agenditapp.com`,
        organizationId: org._id.toString(),
        expiresIn: IMPERSONATION_CODE_TTL_MS / 1000,
      }, "Impersonation code generado exitosamente");

    } catch (error) {
      console.error("[admin/impersonate] Error:", error);
      sendResponse(res, 500, null, "Error al generar impersonation");
    }
  },

  /**
   * GET /api/admin/impersonations
   * Lista auditorías de impersonación (filtrable por org o admin).
   * Query params: organizationId?, adminUserId?, limit? (default 50)
   */
  listAudits: async (req, res) => {
    try {
      const { organizationId, adminUserId, limit = 50 } = req.query;

      const filter = {};
      if (organizationId && mongoose.isValidObjectId(organizationId)) {
        filter.targetOrganizationId = organizationId;
      }
      if (adminUserId && mongoose.isValidObjectId(adminUserId)) {
        filter.adminUserId = adminUserId;
      }

      const audits = await ImpersonationAudit.find(filter)
        .sort({ createdAt: -1 })
        .limit(Math.min(Number(limit), 200))
        .lean();

      sendResponse(res, 200, { audits, total: audits.length });
    } catch (error) {
      console.error("[admin/listAudits] Error:", error);
      sendResponse(res, 500, null, "Error al obtener auditorías");
    }
  },
};

export default adminController;
