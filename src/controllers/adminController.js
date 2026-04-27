import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import AdminUser from "../models/adminUserModel.js";
import Organization from "../models/organizationModel.js";
import ExchangeCode from "../models/exchangeCodeModel.js";
import ImpersonationAudit from "../models/impersonationAuditModel.js";
import Appointment from "../models/appointmentModel.js";
import Client from "../models/clientModel.js";
import Employee from "../models/employeeModel.js";
import Service from "../models/serviceModel.js";
import Reservation from "../models/reservationModel.js";
import Membership from "../models/membershipModel.js";
import Campaign from "../models/campaignModel.js";
import WhatsappTemplate from "../models/whatsappTemplateModel.js";
import Notification from "../models/notificationModel.js";
import PaymentEvent from "../models/paymentEventModel.js";
import PaymentSession from "../models/paymentSessionModel.js";
import Advances from "../models/advancesModel.js";
import Subscription from "../models/subscriptionModel.js";
import ServicePackage from "../models/servicePackageModel.js";
import ClientPackage from "../models/clientPackageModel.js";
import AuditLog from "../models/auditLogModel.js";
import Expense from "../models/expenseModel.js";
import Class from "../models/classModel.js";
import ClassSession from "../models/classSessionModel.js";
import Room from "../models/roomModel.js";
import Enrollment from "../models/enrollmentModel.js";
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
  /**
   * DELETE /api/admin/organizations/:id
   * Elimina una organización y todos sus datos asociados en cascada.
   * Requiere JWT de superadmin.
   */
  deleteOrganization: async (req, res) => {
    try {
      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        return sendResponse(res, 400, null, "ID de organización inválido");
      }

      const org = await Organization.findById(id).select("name slug").lean();
      if (!org) {
        return sendResponse(res, 404, null, "Organización no encontrada");
      }

      const adminId = req.user.adminId;
      const admin = await AdminUser.findById(adminId).select("email").lean();
      const orgId = new mongoose.Types.ObjectId(id);

      await Promise.all([
        Appointment.deleteMany({ organizationId: orgId }),
        Client.deleteMany({ organizationId: orgId }),
        Employee.deleteMany({ organizationId: orgId }),
        Service.deleteMany({ organizationId: orgId }),
        Reservation.deleteMany({ organizationId: orgId }),
        Membership.deleteMany({ organizationId: orgId }),
        Campaign.deleteMany({ organizationId: orgId }),
        WhatsappTemplate.deleteMany({ organizationId: orgId }),
        Notification.deleteMany({ organizationId: orgId }),
        PaymentEvent.deleteMany({ organizationId: orgId }),
        PaymentSession.deleteMany({ organizationId: orgId }),
        Advances.deleteMany({ organizationId: orgId }),
        Subscription.deleteMany({ organizationId: orgId }),
        ServicePackage.deleteMany({ organizationId: orgId }),
        ClientPackage.deleteMany({ organizationId: orgId }),
        ExchangeCode.deleteMany({ organizationId: orgId }),
        AuditLog.deleteMany({ organizationId: orgId }),
        Expense.deleteMany({ organizationId: orgId }),
        Class.deleteMany({ organizationId: orgId }),
        ClassSession.deleteMany({ organizationId: orgId }),
        Room.deleteMany({ organizationId: orgId }),
        Enrollment.deleteMany({ organizationId: orgId }),
        ImpersonationAudit.deleteMany({ targetOrganizationId: orgId }),
      ]);

      await Organization.findByIdAndDelete(id);

      console.log(
        `[SUPERADMIN] ⚠️ Organización "${org.name}" (${org.slug}) eliminada en cascada por ${admin?.email || adminId}`
      );

      sendResponse(res, 200, { organizationId: id, name: org.name }, "Organización eliminada exitosamente");
    } catch (error) {
      console.error("[admin/deleteOrganization] Error:", error);
      sendResponse(res, 500, null, "Error al eliminar la organización");
    }
  },
};

export default adminController;
