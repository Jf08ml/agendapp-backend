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
import ChatLog from "../models/chatLogModel.js";
import ChatbotFeedback from "../models/chatbotFeedbackModel.js";
import Expense from "../models/expenseModel.js";
import Class from "../models/classModel.js";
import ClassSession from "../models/classSessionModel.js";
import Room from "../models/roomModel.js";
import Enrollment from "../models/enrollmentModel.js";
import sendResponse from "../utils/sendResponse.js";
import {
  getPlatformOverview,
  getPlatformTimeSeries,
  getOrganizationRanking,
} from "../services/platformAnalyticsService.js";

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

  // ─── Analítica global de plataforma ────────────────────────────────────────

  /** Resuelve startDate/endDate de query params, con default de últimos 30 días */
  _resolveDateRange: (query) => {
    const endDate = query.endDate || new Date().toISOString().slice(0, 10);
    const startDate =
      query.startDate ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return { startDate, endDate };
  },

  /**
   * GET /api/admin/analytics/overview
   * KPIs globales: nuevas orgs, citas/ingresos, reservas, salud de membresías, MRR.
   */
  getPlatformOverview: async (req, res) => {
    try {
      const { startDate, endDate } = adminController._resolveDateRange(req.query);
      const data = await getPlatformOverview({ startDate, endDate });
      sendResponse(res, 200, data);
    } catch (error) {
      console.error("[admin/getPlatformOverview] Error:", error);
      sendResponse(res, 500, null, "Error al obtener resumen de plataforma");
    }
  },

  /**
   * GET /api/admin/analytics/timeseries
   * Serie temporal global por granularidad (day | week | month).
   */
  getPlatformTimeSeries: async (req, res) => {
    try {
      const { startDate, endDate } = adminController._resolveDateRange(req.query);
      const granularity = ["day", "week", "month"].includes(req.query.granularity)
        ? req.query.granularity
        : "day";
      const data = await getPlatformTimeSeries({ startDate, endDate, granularity });
      sendResponse(res, 200, data);
    } catch (error) {
      console.error("[admin/getPlatformTimeSeries] Error:", error);
      sendResponse(res, 500, null, "Error al obtener serie temporal de plataforma");
    }
  },

  /**
   * GET /api/admin/analytics/organizations
   * Ranking de organizaciones por citas o ingresos en el rango.
   */
  getOrganizationRanking: async (req, res) => {
    try {
      const { startDate, endDate } = adminController._resolveDateRange(req.query);
      const sortBy = req.query.sortBy === "ingresos" ? "ingresos" : "citas";
      const limit = req.query.limit;
      const data = await getOrganizationRanking({ startDate, endDate, sortBy, limit });
      sendResponse(res, 200, data);
    } catch (error) {
      console.error("[admin/getOrganizationRanking] Error:", error);
      sendResponse(res, 500, null, "Error al obtener ranking de organizaciones");
    }
  },

  // ─── Funnel de onboarding / activación ──────────────────────────────────────

  /**
   * GET /api/admin/onboarding/funnel
   * Cohorte de organizaciones registradas en el rango y cuántas alcanzaron cada
   * hito (setup → demo → 1ª cita → WhatsApp → 1er mensaje → pago). Incluye
   * conversión a pago segmentada por hito (qué hito predice mejor la compra).
   */
  getOnboardingFunnel: async (req, res) => {
    try {
      const { startDate, endDate } = adminController._resolveDateRange(req.query);
      const rangeStart = new Date(`${startDate}T00:00:00.000Z`);
      const rangeEnd = new Date(`${endDate}T23:59:59.999Z`);

      // El modelo Organization no tiene timestamps en docs antiguos, así que la
      // fecha de registro se deriva del _id (ObjectId), con fallback a createdAt
      // si existe. Esto hace que la cohorte funcione con todas las orgs.
      const regDateExpr = { $ifNull: ["$createdAt", { $toDate: "$_id" }] };

      const has = (path) => ({ $cond: [{ $ifNull: [path, false] }, 1, 0] });
      const hasAnd = (path) => ({
        $cond: [
          { $and: [{ $ifNull: [path, false] }, { $ifNull: ["$convertedToPayingAt", false] }] },
          1,
          0,
        ],
      });
      // Acumula { _id, name } de las orgs que alcanzaron el hito (omite el resto con $$REMOVE)
      const pushIf = (path) => ({
        $push: {
          $cond: [{ $ifNull: [path, false] }, { _id: "$_id", name: "$name" }, "$$REMOVE"],
        },
      });

      const [agg] = await Organization.aggregate([
        { $addFields: { _regDate: regDateExpr } },
        { $match: { _regDate: { $gte: rangeStart, $lte: rangeEnd } } },
        {
          $group: {
            _id: null,
            registrados: { $sum: 1 },
            setupCompleto: { $sum: has("$onboardingMilestones.setupCompletedAt") },
            conDemo: { $sum: has("$onboardingMilestones.seededDemoAt") },
            primeraCita: { $sum: has("$onboardingMilestones.firstAppointmentAt") },
            whatsappConectado: { $sum: has("$onboardingMilestones.whatsappConnectedAt") },
            primerMensaje: { $sum: has("$onboardingMilestones.firstAutoMessageAt") },
            convertidasPago: { $sum: has("$convertedToPayingAt") },
            // Conversión a pago segmentada por hito alcanzado
            pagoConSetup: { $sum: hasAnd("$onboardingMilestones.setupCompletedAt") },
            pagoConPrimeraCita: { $sum: hasAnd("$onboardingMilestones.firstAppointmentAt") },
            pagoConWhatsapp: { $sum: hasAnd("$onboardingMilestones.whatsappConnectedAt") },
            pagoConPrimerMensaje: { $sum: hasAnd("$onboardingMilestones.firstAutoMessageAt") },
            // Listas de orgs por hito (para drill-down en el panel)
            registradosOrgs: { $push: { _id: "$_id", name: "$name" } },
            setupCompletoOrgs: pushIf("$onboardingMilestones.setupCompletedAt"),
            conDemoOrgs: pushIf("$onboardingMilestones.seededDemoAt"),
            primeraCitaOrgs: pushIf("$onboardingMilestones.firstAppointmentAt"),
            whatsappConectadoOrgs: pushIf("$onboardingMilestones.whatsappConnectedAt"),
            primerMensajeOrgs: pushIf("$onboardingMilestones.firstAutoMessageAt"),
            convertidasPagoOrgs: pushIf("$convertedToPayingAt"),
          },
        },
      ]);

      const d = agg || {
        registrados: 0, setupCompleto: 0, conDemo: 0, primeraCita: 0,
        whatsappConectado: 0, primerMensaje: 0, convertidasPago: 0,
        pagoConSetup: 0, pagoConPrimeraCita: 0, pagoConWhatsapp: 0, pagoConPrimerMensaje: 0,
        registradosOrgs: [], setupCompletoOrgs: [], conDemoOrgs: [], primeraCitaOrgs: [],
        whatsappConectadoOrgs: [], primerMensajeOrgs: [], convertidasPagoOrgs: [],
      };
      // Normaliza {_id,name} → {id,name} (string) y ordena por nombre
      const orgList = (arr) =>
        (arr || [])
          .map((o) => ({ id: String(o._id), name: o.name || "—" }))
          .sort((a, b) => a.name.localeCompare(b.name));
      const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

      sendResponse(res, 200, {
        startDate,
        endDate,
        // Funnel: cada hito como conteo + % sobre registrados
        funnel: [
          { hito: "Registrados", clave: "registrados", total: d.registrados, pct: d.registrados > 0 ? 100 : 0, orgs: orgList(d.registradosOrgs) },
          { hito: "Completó/saltó setup", clave: "setupCompleto", total: d.setupCompleto, pct: pct(d.setupCompleto, d.registrados), orgs: orgList(d.setupCompletoOrgs) },
          { hito: "Usó datos de ejemplo", clave: "conDemo", total: d.conDemo, pct: pct(d.conDemo, d.registrados), orgs: orgList(d.conDemoOrgs) },
          { hito: "Creó 1ª cita", clave: "primeraCita", total: d.primeraCita, pct: pct(d.primeraCita, d.registrados), orgs: orgList(d.primeraCitaOrgs) },
          { hito: "Conectó WhatsApp", clave: "whatsappConectado", total: d.whatsappConectado, pct: pct(d.whatsappConectado, d.registrados), orgs: orgList(d.whatsappConectadoOrgs) },
          { hito: "1er mensaje automático", clave: "primerMensaje", total: d.primerMensaje, pct: pct(d.primerMensaje, d.registrados), orgs: orgList(d.primerMensajeOrgs) },
          { hito: "Convirtió a pago", clave: "convertidasPago", total: d.convertidasPago, pct: pct(d.convertidasPago, d.registrados), orgs: orgList(d.convertidasPagoOrgs) },
        ],
        // % de conversión a pago entre quienes alcanzaron cada hito (qué predice la compra)
        conversionPorHito: [
          { hito: "Completó setup", base: d.setupCompleto, pagaron: d.pagoConSetup, tasaPago: pct(d.pagoConSetup, d.setupCompleto) },
          { hito: "Creó 1ª cita", base: d.primeraCita, pagaron: d.pagoConPrimeraCita, tasaPago: pct(d.pagoConPrimeraCita, d.primeraCita) },
          { hito: "Conectó WhatsApp", base: d.whatsappConectado, pagaron: d.pagoConWhatsapp, tasaPago: pct(d.pagoConWhatsapp, d.whatsappConectado) },
          { hito: "1er mensaje automático", base: d.primerMensaje, pagaron: d.pagoConPrimerMensaje, tasaPago: pct(d.pagoConPrimerMensaje, d.primerMensaje) },
        ],
      });
    } catch (error) {
      console.error("[admin/getOnboardingFunnel] Error:", error);
      sendResponse(res, 500, null, "Error al obtener el funnel de onboarding");
    }
  },

  // ─── Analítica de chatbots (ChatLog) ────────────────────────────────────────

  /**
   * GET /api/admin/chatbot/stats
   * Métricas agregadas de los chatbots (admin + booking) en el rango:
   * sesiones, rondas, tokens, errores, round-limit, funnel de conversión
   * (sesión → payload preparado → reserva creada) y desglose por organización.
   */
  getChatbotStats: async (req, res) => {
    try {
      const { startDate, endDate } = adminController._resolveDateRange(req.query);
      const range = {
        createdAt: {
          $gte: new Date(`${startDate}T00:00:00.000Z`),
          $lte: new Date(`${endDate}T23:59:59.999Z`),
        },
      };

      const [byType, funnel, byOrg, feedback] = await Promise.all([
        // Totales por tipo de chatbot
        ChatLog.aggregate([
          { $match: range },
          {
            $group: {
              _id: "$type",
              sesiones: { $sum: 1 },
              rondasPromedio: { $avg: "$rounds" },
              inputTokens: { $sum: "$inputTokens" },
              outputTokens: { $sum: "$outputTokens" },
              duracionPromedioMs: { $avg: "$durationMs" },
              conRoundLimit: { $sum: { $cond: ["$hitRoundLimit", 1, 0] } },
              conError: { $sum: { $cond: [{ $ifNull: ["$error", false] }, 1, 0] } },
            },
          },
        ]),
        // Funnel de conversión del booking bot
        ChatLog.aggregate([
          { $match: { ...range, type: "booking" } },
          {
            $group: {
              _id: null,
              sesiones: { $sum: 1 },
              conPayload: { $sum: { $cond: [{ $ifNull: ["$bookingPayload", false] }, 1, 0] } },
              convertidas: { $sum: { $cond: ["$reservationCreated", 1, 0] } },
            },
          },
        ]),
        // Desglose por organización (top 20 por sesiones)
        ChatLog.aggregate([
          { $match: range },
          {
            $group: {
              _id: "$organizationId",
              sesiones: { $sum: 1 },
              booking: { $sum: { $cond: [{ $eq: ["$type", "booking"] }, 1, 0] } },
              admin: { $sum: { $cond: [{ $eq: ["$type", "admin"] }, 1, 0] } },
              conPayload: { $sum: { $cond: [{ $ifNull: ["$bookingPayload", false] }, 1, 0] } },
              convertidas: { $sum: { $cond: ["$reservationCreated", 1, 0] } },
              inputTokens: { $sum: "$inputTokens" },
              outputTokens: { $sum: "$outputTokens" },
            },
          },
          { $sort: { sesiones: -1 } },
          { $limit: 20 },
          {
            $lookup: {
              from: "organizations",
              localField: "_id",
              foreignField: "_id",
              as: "org",
            },
          },
          {
            $project: {
              organizationId: "$_id",
              nombre: { $ifNull: [{ $arrayElemAt: ["$org.name", 0] }, "(eliminada)"] },
              sesiones: 1,
              booking: 1,
              admin: 1,
              conPayload: 1,
              convertidas: 1,
              inputTokens: 1,
              outputTokens: 1,
              _id: 0,
            },
          },
        ]),
        // Satisfacción promedio (feedback del booking bot)
        ChatbotFeedback.aggregate([
          { $match: range },
          {
            $group: {
              _id: "$source",
              total: { $sum: 1 },
              ratingPromedio: { $avg: "$rating" },
            },
          },
        ]),
      ]);

      const f = funnel[0] || { sesiones: 0, conPayload: 0, convertidas: 0 };
      const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

      sendResponse(res, 200, {
        startDate,
        endDate,
        porTipo: byType,
        funnelBooking: {
          sesiones: f.sesiones,
          conPayloadPreparado: f.conPayload,
          reservasCreadas: f.convertidas,
          tasaPreparacion: pct(f.conPayload, f.sesiones),
          tasaConversionPayload: pct(f.convertidas, f.conPayload),
          tasaConversionTotal: pct(f.convertidas, f.sesiones),
        },
        porOrganizacion: byOrg,
        feedback,
      });
    } catch (error) {
      console.error("[admin/getChatbotStats] Error:", error);
      sendResponse(res, 500, null, "Error al obtener métricas de chatbots");
    }
  },

  /**
   * GET /api/admin/chatbot/sessions
   * Lista paginada de sesiones de chat con filtros:
   * type (admin|booking), organizationId, converted (true), hasError (true),
   * hitRoundLimit (true), page, limit.
   */
  getChatbotSessions: async (req, res) => {
    try {
      const { startDate, endDate } = adminController._resolveDateRange(req.query);
      const filter = {
        createdAt: {
          $gte: new Date(`${startDate}T00:00:00.000Z`),
          $lte: new Date(`${endDate}T23:59:59.999Z`),
        },
      };
      if (["admin", "booking"].includes(req.query.type)) filter.type = req.query.type;
      if (req.query.organizationId && mongoose.Types.ObjectId.isValid(req.query.organizationId)) {
        filter.organizationId = req.query.organizationId;
      }
      if (req.query.converted === "true") filter.reservationCreated = true;
      if (req.query.hasError === "true") filter.error = { $exists: true, $ne: null };
      if (req.query.hitRoundLimit === "true") filter.hitRoundLimit = true;

      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

      const [sessions, total] = await Promise.all([
        ChatLog.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .populate("organizationId", "name slug")
          .lean(),
        ChatLog.countDocuments(filter),
      ]);

      sendResponse(res, 200, { sessions, total, page, pages: Math.ceil(total / limit) });
    } catch (error) {
      console.error("[admin/getChatbotSessions] Error:", error);
      sendResponse(res, 500, null, "Error al obtener sesiones de chat");
    }
  },
};

export default adminController;
