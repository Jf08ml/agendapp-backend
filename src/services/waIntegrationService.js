// services/waIntegrationService.js
import Organization from "../models/organizationModel.js";
import {
  waStartSession,
  waGetStatus,
  waSend,
  waRestart,
  waLogout,
} from "./waHttpService.js";
import { issueWsToken } from "./wsTokenService.js";

export const waIntegrationService = {
  async connectOrganizationSession({ orgId, clientId, userId }) {
    const org = await Organization.findById(orgId);
    if (!org) throw new Error("Organización no encontrada");

    org.clientIdWhatsapp = clientId;
    await org.save();

    await waStartSession(clientId);

    const { token, expiresIn } = issueWsToken({ userId, orgId, clientId });

    return {
      ok: true,
      clientId,
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
    const org = await Organization.findById(orgId);
    if (!org) throw new Error("Organización no encontrada");
    if (!clientId) clientId = org.clientIdWhatsapp;
    if (!clientId)
      throw new Error("La organización no tiene clientId de WhatsApp");

    // Validación básica
    if (!phone) throw new Error("Falta phone");
    if (!message && !image) throw new Error("Debes enviar 'message' o 'image'");

    const r = await waSend({ clientId, phone, message, image });
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
