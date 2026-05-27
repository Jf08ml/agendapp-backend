// src/services/whatsappService.js
import axiosBase from "axios";
import http from "http";
import https from "https";
import organizationService from "./organizationService.js";
import membershipService from "./membershipService.js";
import whatsappTemplates from "../utils/whatsappTemplates.js";
import { normalizePhoneNumber, toWhatsappFormat } from "../utils/phoneUtils.js";
import { sendTextMessage as metaSendText, sendTemplateMessage as metaSendTemplate } from "./metaTemplateService.js";
import { sendMetaTemplateNotification } from "./metaSendWhatsapp.js";

/** ===================== CONFIG ===================== */
const BASE_URL = process.env.WA_API_URL;
const API_KEY = process.env.WA_API_KEY;

if (!BASE_URL)
  console.warn("[whatsappService] WA_API_URL no definido");
if (!API_KEY)
  console.warn("[whatsappService] WA_API_KEY no definido");

// Reutiliza conexiones (evita TIME_WAIT y latencias)
const keepAliveHttp = new http.Agent({ keepAlive: true, maxSockets: 50 });
const keepAliveHttps = new https.Agent({ keepAlive: true, maxSockets: 50 });

// Cliente “corto” (para acciones normales)
const api = axiosBase.create({
  baseURL: (BASE_URL || "").replace(/\/$/, ""),
  headers: { "x-api-key": API_KEY },
  timeout: 20_000,
  httpAgent: keepAliveHttp,
  httpsAgent: keepAliveHttps,
});

// Cliente “largo” (para jobs/lotes como recordatorios)
const apiLong = axiosBase.create({
  baseURL: (BASE_URL || "").replace(/\/$/, ""),
  headers: { "x-api-key": API_KEY },
  timeout: 90_000, // <<— más holgado
  httpAgent: keepAliveHttp,
  httpsAgent: keepAliveHttps,
});

/** =================================================== */

const whatsappService = {
  /** ⚡ Helper para normalizar teléfonos para WhatsApp */
  normalizePhoneForWhatsapp(phone, defaultCountry = 'CO') {
    if (!phone) return '';
    
    // Usar normalización internacional
    const result = normalizePhoneNumber(phone, defaultCountry);
    if (result.isValid && result.phone_e164) {
      // Convertir a formato WhatsApp (maneja México 52→521)
      return toWhatsappFormat(result.phone_e164);
    }
    
    // Fallback: limpiar caracteres no numéricos y aplicar formato WA
    const cleaned = phone.replace(/[^\d]/g, '');
    console.warn('[whatsappService] Fallback para:', phone, '→', cleaned);
    return toWhatsappFormat(cleaned);
  },

  /** ===================== Multi-sesión (Baileys) ===================== */

  // Idempotente: asegura que la sesión exista en el backend
  async ensureSession(clientId) {
    if (!clientId) return;
    try {
      await api.post(`/api/session`, { clientId }, { timeout: 5000 });
    } catch (e) {
      console.warn(
        "[whatsappService.ensureSession] No se pudo asegurar sesión:",
        e?.message
      );
    }
  },

  // NEW: consulta estados para saber si una sesión está lista
  async isClientReady(clientId) {
    try {
      const { data } = await api.get(`/api/sessions`, { timeout: 8000 });
      return !!data.find(
        (s) => s.clientId === clientId && s.status === "ready"
      );
    } catch (e) {
      console.warn(
        "[whatsappService.isClientReady] No se pudo leer /api/sessions:",
        e?.message
      );
      return false;
    }
  },

  // Enviar con reintento suave si es el clásico "Session/Target closed"
  async sendViaMultiSession(payload, { longTimeout = false } = {}) {
    await this.ensureSession(payload.clientId);
    const client = longTimeout ? apiLong : api;

    try {
      const { data } = await client.post(`/api/send`, payload);
      return data;
    } catch (error) {
      // Respuesta con error del backend
      if (error?.response?.data) {
        const body = error.response.data;
        const raw = String(body.error || "");
        if (
          /Session closed|Target closed|Protocol error|WebSocket is not open/i.test(
            raw
          )
        ) {
          // breve espera y un reintento
          await new Promise((r) => setTimeout(r, 800));
          const { data } = await client.post(`/api/send`, payload);
          return data;
        }
        throw new Error(body.error || "Error WhatsApp API");
      }
      // Timeout de Axios u otros de red
      throw new Error(error?.message || "Error de red enviando WhatsApp");
    }
  },

  /**
   * Envía un mensaje usando la sesión WA de la organización.
   * @param {string} organizationId
   * @param {string} phone
   * @param {string} message
   * @param {string} [image] url o base64
   */
  async sendMessage(organizationId, phone, message, image, opts = {}) {
    // Verificar si el plan permite WhatsApp
    const planLimits = await membershipService.getPlanLimits(organizationId);
    if (planLimits && planLimits.whatsappIntegration === false) {
      console.log(`[whatsappService] WhatsApp bloqueado por plan para org ${organizationId}`);
      return { blocked: true, reason: "plan_limit" };
    }

    const org = await organizationService.getOrganizationById(organizationId);

    // ── Routing híbrido ──────────────────────────────────────────────────────
    if (org?.waConnectionType === "meta") {
      const normalizedPhone = this.normalizePhoneForWhatsapp(phone, org.default_country || "CO");
      return metaSendText(org, normalizedPhone, message);
    }

    // ── Baileys (comportamiento actual) ─────────────────────────────────────
    if (!org || !org.clientIdWhatsapp) {
      throw new Error("La organización no tiene sesión de WhatsApp configurada");
    }
    const payload = {
      clientId: org.clientIdWhatsapp,
      phone: this.normalizePhoneForWhatsapp(phone, org.default_country || "CO"),
      message,
    };
    if (image) payload.image = image;

    return this.sendViaMultiSession(payload, opts);
  },

  /**
   * High-level notification sender. Routes to Meta template or Baileys text.
   *
   * For Meta orgs: sends via an approved Meta template using structured data.
   * Falls back to free-text (sendMessage) if the template is not found / not approved.
   *
   * For Baileys orgs: renders the template text and calls sendMessage as usual.
   *
   * @param {string} organizationId
   * @param {string} phone
   * @param {string} templateType    - e.g. "scheduleAppointmentBatch", "reminder"
   * @param {Object} data            - variable data (names, date, organization, ...)
   * @param {Object} [opts]
   * @param {string} [opts.fallbackMessage] - pre-rendered text to use as fallback on Meta
   */
  async sendNotification(organizationId, phone, templateType, data, opts = {}) {
    const planLimits = await membershipService.getPlanLimits(organizationId);
    if (planLimits && planLimits.whatsappIntegration === false) {
      console.log(`[sendNotification] WhatsApp bloqueado por plan para org ${organizationId}`);
      return { blocked: true, reason: "plan_limit" };
    }

    const org = await organizationService.getOrganizationById(organizationId);

    if (org?.waConnectionType === "meta") {
      const normalizedPhone = this.normalizePhoneForWhatsapp(phone, org.default_country || "CO");

      // Try Meta template first
      try {
        const result = await sendMetaTemplateNotification(org, normalizedPhone, templateType, data);
        if (result) return result;
      } catch (err) {
        console.error(`[sendNotification] Meta template error for "${templateType}":`, err.message);
      }

      // Fall back to free text if template not available/approved
      if (opts.fallbackMessage) {
        console.warn(`[sendNotification] Falling back to free text for "${templateType}" on org ${org._id}`);
        return metaSendText(org, normalizedPhone, opts.fallbackMessage);
      }

      console.warn(`[sendNotification] No template and no fallback for "${templateType}" on org ${org._id} — skipping`);
      return null;
    }

    // Baileys: render and send as text
    const msg = await whatsappTemplates.getRenderedTemplate(organizationId, templateType, data);
    return this.sendMessage(organizationId, phone, msg, null, opts);
  },

  /**
   * Envía un mensaje usando plantilla Meta (solo para orgs con waConnectionType === 'meta').
   */
  async sendTemplateMessage(organizationId, phone, templateName, language, components = []) {
    const planLimits = await membershipService.getPlanLimits(organizationId);
    if (planLimits && planLimits.whatsappIntegration === false) {
      return { blocked: true, reason: "plan_limit" };
    }
    const org = await organizationService.getOrganizationById(organizationId);
    if (org?.waConnectionType !== "meta") {
      throw new Error("sendTemplateMessage solo está disponible para orgs con Meta API configurada.");
    }
    const normalizedPhone = this.normalizePhoneForWhatsapp(phone, org.default_country || "CO");
    return metaSendTemplate(org, normalizedPhone, templateName, language, components);
  },

  /**
   * Notifica estado de reserva (aprobada/rechazada) por la sesión WA de la organización.
   * Soporta tanto Baileys como Meta.
   */
  async sendWhatsappStatusReservation(
    status,
    reservation,
    reservationDetails,
    opts = {}
  ) {
    const org = reservation?.organizationId;
    if (!org) throw new Error("La organización no está disponible en la reserva");

    // Verificar si el plan permite WhatsApp
    const planLimits = await membershipService.getPlanLimits(org._id);
    if (planLimits && planLimits.whatsappIntegration === false) {
      console.log(`[whatsappService] WhatsApp bloqueado por plan para org ${org._id}`);
      return { blocked: true, reason: "plan_limit" };
    }

    const templateType = status === "approved"
      ? "statusReservationApproved"
      : "statusReservationRejected";

    const phone = reservation?.customerDetails?.phone;
    const normalizedPhone = this.normalizePhoneForWhatsapp(phone, org.default_country);

    // ── Meta routing ──────────────────────────────────────────────────────────
    if (org?.waConnectionType === "meta") {
      try {
        const result = await sendMetaTemplateNotification(org, normalizedPhone, templateType, reservationDetails);
        if (result) return result;
      } catch (err) {
        console.error(`[sendWhatsappStatusReservation] Meta template error:`, err.message);
      }

      // Fallback to free text for Meta
      const fallbackMsg = await whatsappTemplates.getRenderedTemplate(org, templateType, reservationDetails);
      console.warn(`[sendWhatsappStatusReservation] Falling back to free text for "${templateType}" on org ${org._id}`);
      return metaSendText(org, normalizedPhone, fallbackMsg);
    }

    // ── Baileys ───────────────────────────────────────────────────────────────
    if (!org.clientIdWhatsapp) {
      throw new Error("La organización no tiene sesión de WhatsApp configurada");
    }

    const msg = await whatsappTemplates.getRenderedTemplate(org, templateType, reservationDetails);
    const payload = {
      clientId: org.clientIdWhatsapp,
      phone: normalizedPhone,
      message: msg,
    };

    return this.sendViaMultiSession(payload, opts);
  },
};

export default whatsappService;
