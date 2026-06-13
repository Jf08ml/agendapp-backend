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
import { markOnboardingMilestone } from "../utils/onboardingMilestones.js";
import { getVerticalCatalog } from "../utils/verticalCatalogs.js";

// Detecta de forma defensiva si el status del wa-backend indica "conectado",
// sin asumir una forma exacta (puede venir como status/code/state/connected).
function isWaReady(s) {
  if (!s || typeof s !== "object") return false;
  const v = String(s.status ?? s.code ?? s.state ?? "").toLowerCase();
  return s.connected === true || v === "ready" || v === "connected";
}

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
    // 📊 Instrumentación: marcar primera conexión de WhatsApp (idempotente, defensivo
    // ante distintas formas de respuesta del wa-backend)
    if (waStatus && isWaReady(waStatus)) {
      markOnboardingMilestone(orgId, "whatsappConnectedAt");
    }
    return { organization: org, waStatus };
  },

  // Envía al PROPIO número del negocio un recordatorio de ejemplo, para que el
  // dueño vea en su WhatsApp exactamente lo que recibirían sus clientes (el "aha").
  // Se dispara al conectar WhatsApp por primera vez. Idempotente: no reenvía si ya
  // se mandó antes.
  async sendWelcomeTest({ orgId, phone, force = false }) {
    const org = await Organization.findById(orgId);
    if (!org) throw new Error("Organización no encontrada");

    // Marcar conexión (por si el status aún no lo capturó)
    markOnboardingMilestone(orgId, "whatsappConnectedAt");

    // Idempotencia real: no reenviar el mensaje automático salvo que se fuerce
    // (botón manual). NO se gatilla por whatsappConnectedAt.
    if (!force && org.onboardingMilestones?.firstAutoMessageAt) {
      return { sent: false, alreadySent: true };
    }

    const cleanJid = (p) => (p ? String(p).split("@")[0].split(":")[0] : "");

    // CRÍTICO: preguntar al wa-backend cuál es el número REALMENTE conectado y
    // enviar ahí. Es autoritativo y robusto ante un teléfono mal puesto en el
    // registro (causa real de "envié pero no llegó"). Solo si no se obtiene, se
    // cae al hint del frontend o a los teléfonos guardados.
    let connectedNumber = "";
    if (org.clientIdWhatsapp) {
      try {
        const st = await waGetStatus(org.clientIdWhatsapp);
        connectedNumber = cleanJid(st?.me?.id || st?.me?.jid || st?.user?.id);
      } catch {}
    }

    const ownPhone = connectedNumber || cleanJid(phone) || org.waPhone || org.phoneNumber;
    if (!ownPhone) {
      return { sent: false, reason: "no_phone" };
    }

    const firstName = (org.ownerName || "").trim().split(/\s+/)[0] || "👋";
    const place = org.address ? org.address : org.name;
    // Servicio de ejemplo según el rubro (para que se vea realista)
    const sampleService = getVerticalCatalog(org.businessVertical).services[0]?.name || "tu servicio";
    const message =
      `🔔 *Recordatorio de cita* — ${org.name}\n\n` +
      `¡Hola ${firstName}! Este es un *ejemplo* del recordatorio automático que tus clientes recibirán por WhatsApp:\n\n` +
      `━━━━━━━━━━━━━━\n` +
      `Hola Juan 👋 Te recordamos tu cita en *${org.name}*:\n` +
      `• ${sampleService}\n` +
      `📅 Mañana a las 3:00 p. m.\n` +
      `📍 ${place}\n` +
      `━━━━━━━━━━━━━━\n\n` +
      `Así de fácil tus clientes no olvidarán sus citas. ✅\n` +
      `Puedes personalizar este mensaje en *Mensajes de WhatsApp*.`;

    try {
      const r = await this.sendMessage({ orgId, phone: ownPhone, message });
      if (r?.blocked) return { sent: false, reason: "plan_limit" };
      markOnboardingMilestone(orgId, "firstAutoMessageAt");
      return { sent: true, to: ownPhone };
    } catch (err) {
      console.error("[sendWelcomeTest] Error:", err?.message || err);
      return { sent: false, reason: "send_failed" };
    }
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
