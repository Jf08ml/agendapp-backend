// services/waIntegrationService.js
import Organization from "../models/organizationModel.js";
import membershipService from "./membershipService.js";
import {
  waStartSession,
  waGetStatus,
  waSend,
  waRestart,
  waLogout,
  waStartPairing,
} from "./waHttpService.js";
import { issueWsToken } from "./wsTokenService.js";

export const waIntegrationService = {
  async connectOrganizationSession({ orgId, clientId, userId, pairingPhone }) {
    const org = await Organization.findById(orgId);
    if (!org) throw new Error("Organización no encontrada");

    org.clientIdWhatsapp = clientId;
    await org.save();

    // LÓGICA DE DECISIÓN: ¿QR o Pairing?
    if (pairingPhone) {
      // Si hay teléfono, iniciamos modo Pairing
      console.log(
        `[WA] Iniciando Pairing para ${clientId} con ${pairingPhone}`
      );
      await waStartPairing(clientId, pairingPhone);
    } else {
      // Si no, iniciamos modo QR estándar
      console.log(`[WA] Iniciando QR para ${clientId}`);
      await waStartSession(clientId);
    }

    const { token, expiresIn } = issueWsToken({ userId, orgId, clientId });

    return {
      ok: true,
      clientId,
      mode: pairingPhone ? "pairing" : "qr", // Le avisamos al front qué modo se activó
      ws: { url: process.env.WA_WS_URL, token, expiresIn },
    };
  },

  async getOrganizationWaStatus({ orgId }) {
    const org = await Organization.findById(orgId)
      .select("-password")
      .populate("role");
    if (!org) throw new Error("Organización no encontrada");
    const clientId = org.clientIdWhatsapp;
    let waStatus = null;
    if (clientId) {
      try {
        waStatus = await waGetStatus(clientId);
      } catch {}
    }
    return { organization: org, waStatus };
  },

  // ⬇️ NUEVO: enviar mensaje vía wa-backend
  async sendMessage({ orgId, clientId, phone, message, image }) {
    // Verificar si el plan permite WhatsApp
    const planLimits = await membershipService.getPlanLimits(orgId);
    if (planLimits && planLimits.whatsappIntegration === false) {
      console.log(`[waIntegrationService] WhatsApp bloqueado por plan para org ${orgId}`);
      return { blocked: true, reason: "plan_limit" };
    }

    const org = await Organization.findById(orgId);
    console.log("sendMessage", { orgId, clientId, phone, message, image });
    if (!org) throw new Error("Organización no encontrada");
    if (!clientId) clientId = org.clientIdWhatsapp;
    if (!clientId)
      throw new Error("La organización no tiene clientId de WhatsApp");

    // Validación básica
    if (!phone) throw new Error("Falta phone");
    if (!message && !image) throw new Error("Debes enviar 'message' o 'image'");
    
    // 🌍 Normalizar teléfono a E.164 sin el símbolo + (Baileys lo requiere así)
    let normalizedPhone = phone;
    
    // Importar utilidad de normalización
    const { normalizePhoneNumber, toWhatsappFormat } = await import('../utils/phoneUtils.js');
    const result = normalizePhoneNumber(phone, org.default_country || 'CO');
    
    if (result.isValid && result.phone_e164) {
      // Convertir a formato WhatsApp (maneja México 52→521)
      normalizedPhone = toWhatsappFormat(result.phone_e164);
      console.log(`[waIntegrationService] Normalizado: ${phone} → ${result.phone_e164} → ${normalizedPhone}`);
    } else {
      // Fallback: limpiar el número de caracteres no numéricos y aplicar formato WA
      normalizedPhone = toWhatsappFormat(phone.replace(/[^\d]/g, ''));
      console.warn(`[waIntegrationService] Normalización falló para: ${phone}, usando limpio: ${normalizedPhone}`);
    }
    
    console.log("Enviando WhatsApp a", normalizedPhone, { message, image });
    const r = await waSend({ clientId, phone: normalizedPhone, message, image });
    console.log("waSend result:", r);
    return r;
  },

  // ⬇️ NUEVO: reiniciar sesión
  async restart({ orgId, clientId }) {
    const org = await Organization.findById(orgId);
    if (!org) throw new Error("Organización no encontrada");
    if (!clientId) clientId = org.clientIdWhatsapp;
    if (!clientId)
      throw new Error("La organización no tiene clientId de WhatsApp");
    return waRestart(clientId);
  },

  // ⬇️ NUEVO: cerrar sesión
  async logout({ orgId, clientId }) {
    const org = await Organization.findById(orgId);
    if (!org) throw new Error("Organización no encontrada");
    if (!clientId) clientId = org.clientIdWhatsapp;
    if (!clientId)
      throw new Error("La organización no tiene clientId de WhatsApp");
    return waLogout(clientId);
  },
};
