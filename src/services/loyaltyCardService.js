/**
 * loyaltyCardService.js
 *
 * Tarjeta virtual de fidelidad: cada cliente tiene un enlace personal
 * (/mi-tarjeta/:token) con su progreso de servicios y referidos y un QR. El
 * token es aleatorio (no adivinable), se genera la primera vez que se pide y no
 * cambia, así el cliente puede guardar el enlace en la pantalla de inicio.
 *
 * El negocio escanea el QR (o abre el enlace con sesión iniciada) y registra el
 * servicio / referido con el registro manual de siempre (clientService).
 */

import crypto from "crypto";
import Client from "../models/clientModel.js";
import Organization from "../models/organizationModel.js";
import clientService from "./clientService.js";
import whatsappService from "./sendWhatsappService.js";
import whatsappTemplates from "../utils/whatsappTemplates.js";
import { resolveBaseUrl } from "../utils/cancellationUtils.js";

function newToken() {
  return crypto.randomBytes(16).toString("base64url"); // 22 caracteres
}

/** Devuelve el token del cliente, creándolo si aún no tiene (atómico). */
export async function ensureLoyaltyCardToken(client) {
  if (client.loyaltyCardToken) return client.loyaltyCardToken;
  const token = newToken();
  const updated = await Client.findOneAndUpdate(
    { _id: client._id, loyaltyCardToken: { $exists: false } },
    { $set: { loyaltyCardToken: token } },
    { new: true }
  ).select("loyaltyCardToken");
  if (updated?.loyaltyCardToken) return updated.loyaltyCardToken;
  // Otro proceso lo generó primero: leer el que quedó.
  const fresh = await Client.findById(client._id).select("loyaltyCardToken").lean();
  return fresh?.loyaltyCardToken || null;
}

export function buildLoyaltyCardUrl(org, token) {
  return `${resolveBaseUrl(org)}/mi-tarjeta/${token}`;
}

/** Enlace a la tarjeta de un cliente (lo crea si hace falta). null si falla. */
export async function getLoyaltyCardUrl(client, org) {
  try {
    const token = await ensureLoyaltyCardToken(client);
    return token ? buildLoyaltyCardUrl(org, token) : null;
  } catch (err) {
    console.warn("[loyaltyCard] No se pudo generar el enlace:", err?.message || err);
    return null;
  }
}

const CARD_ORG_FIELDS =
  "name slug domains branding loyaltyCard serviceTiers referralTiers serviceCount serviceReward referredCount referredReward showLoyaltyProgram";

function publicCardPayload(client, org) {
  return {
    client: {
      name: client.name,
      servicesTaken: client.servicesTaken || 0,
      referralsMade: client.referralsMade || 0,
      rewardHistory: (client.rewardHistory || []).map((r) => ({
        _id: r._id,
        type: r.type,
        reward: r.reward,
        earnedAt: r.earnedAt,
        redeemed: r.redeemed,
      })),
      memberSince: client.createdAt || null,
    },
    organization: {
      _id: org._id,
      name: org.name,
      branding: {
        logoUrl: org.branding?.logoUrl || null,
        primaryColor: org.branding?.primaryColor || null,
      },
      loyaltyCard: org.loyaltyCard || {},
      serviceTiers: org.serviceTiers || [],
      referralTiers: org.referralTiers || [],
      serviceCount: org.serviceCount || 0,
      serviceReward: org.serviceReward || "",
      referredCount: org.referredCount || 0,
      referredReward: org.referredReward || "",
    },
  };
}

/**
 * Tarjeta pública por token. Solo datos de fidelidad (nombre y progreso): ni
 * teléfono, ni email, ni el id del cliente.
 */
export async function getPublicCard(token) {
  if (!token || typeof token !== "string" || token.length > 64) return null;
  const client = await Client.findOne({ loyaltyCardToken: token })
    .select("name servicesTaken referralsMade rewardHistory organizationId createdAt")
    .lean();
  if (!client) return null;
  const org = await Organization.findById(client.organizationId).select(CARD_ORG_FIELDS).lean();
  if (!org || org.showLoyaltyProgram === false) return null;
  return publicCardPayload(client, org);
}

/** Cliente de la org por token (panel admin, tras escanear el QR). */
export async function getClientByCardToken(organizationId, token) {
  if (!token || typeof token !== "string" || token.length > 64) return null;
  return Client.findOne({ loyaltyCardToken: token, organizationId }).lean();
}

// Anti-spam del envío por WhatsApp desde la página pública: 1 envío por
// teléfono y org cada 2 minutos (en memoria; el rate limit general de la API
// sigue aplicando).
const REQUEST_COOLDOWN_MS = 2 * 60 * 1000;
const lastRequestAt = new Map();

/**
 * Página pública: el cliente escribe su teléfono y se le envía el enlace por
 * WhatsApp (por el canal de la org). Así nadie ve la tarjeta de otro con solo
 * saber su número.
 *
 * Si la org no puede enviar WhatsApp (plan sin WhatsApp, sin sesión, Meta fuera
 * de la ventana de 24 h…), se devuelve el token para mostrarla directamente:
 * mismo comportamiento que tenía la consulta por teléfono.
 *
 * @returns {{ status: "not_found" } | { status: "sent" } | { status: "cooldown" } | { status: "direct", token }}
 */
export async function requestCardByPhone(org, phone) {
  let client = null;
  try {
    client = await clientService.getClientByPhoneNumberAndOrganization(phone, org._id);
  } catch {
    client = null; // lanza "Cliente no encontrado"
  }
  if (!client) return { status: "not_found" };

  const token = await ensureLoyaltyCardToken(client);
  const destination = client.phone_e164 || client.phoneNumber;

  const key = `${org._id}:${client._id}`;
  const last = lastRequestAt.get(key);
  if (last && Date.now() - last < REQUEST_COOLDOWN_MS) return { status: "cooldown" };

  if (destination) {
    lastRequestAt.set(key, Date.now());
    const orgId = String(org._id);
    const data = {
      names: client.name || "",
      organization: org.name || "",
      cardUrl: buildLoyaltyCardUrl(org, token),
    };
    try {
      // Plantilla "loyaltyCardLink": Baileys la renderiza como texto (editable
      // en Mensajes de WhatsApp); Meta usa la plantilla aprobada
      // "tarjeta_fidelidad" — el cliente pide la tarjeta desde la web, casi
      // nunca hay ventana de 24 h abierta, así que el texto libre no llegaba.
      // El texto renderizado queda como respaldo (coexistencia / ventana abierta).
      const fallbackMessage = await whatsappTemplates.getRenderedTemplate(orgId, "loyaltyCardLink", data);
      const result = await whatsappService.sendNotification(orgId, destination, "loyaltyCardLink", data, {
        fallbackMessage,
      });
      if (result && !result.blocked) return { status: "sent" };
    } catch (err) {
      console.warn(`[loyaltyCard] No se pudo enviar el enlace por WhatsApp (org ${org._id}):`, err?.message || err);
    }
    lastRequestAt.delete(key);
  }
  return { status: "direct", token };
}

// Limpieza periódica del mapa de cooldown.
setInterval(() => {
  const now = Date.now();
  for (const [k, t] of lastRequestAt) if (now - t > REQUEST_COOLDOWN_MS) lastRequestAt.delete(k);
}, 10 * 60 * 1000).unref?.();

export default {
  ensureLoyaltyCardToken,
  buildLoyaltyCardUrl,
  getLoyaltyCardUrl,
  getPublicCard,
  getClientByCardToken,
  requestCardByPhone,
};
