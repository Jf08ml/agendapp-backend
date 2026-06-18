/**
 * mpConnectService.js
 *
 * Conexión OAuth (marketplace) de la cuenta de cobro de cada organización con
 * Mercado Pago. Patrón: el dueño autoriza nuestra aplicación → recibimos su
 * access_token/refresh_token/user_id y los guardamos por-org. Los pagos se crean
 * luego con el token del vendedor → el dinero va DIRECTO a su cuenta (la plataforma
 * no toca fondos).
 *
 * Multi-país: las credenciales de la aplicación MP se eligen por país
 * (Organization.default_country) vía env vars MP_<PAIS>_CLIENT_ID / _SECRET.
 *
 * El access_token de MP dura 180 días; se refresca con el refresh_token
 * (cron mpTokenRefreshJob). Cada refresh devuelve un par NUEVO (access+refresh).
 */

import axios from "axios";
import crypto from "crypto";
import Organization from "../../models/organizationModel.js";
import { encryptSecret, decryptSecret } from "../../utils/cryptoTokens.js";
import { normalizeCountry, getCountryMeta } from "./mpCountries.js";

const AUTH_BASE = "https://auth.mercadopago.com/authorization";
const TOKEN_URL = "https://api.mercadopago.com/oauth/token";

// Credenciales de la aplicación MP por país (integrador/plataforma).
function appCreds(country) {
  const cc = normalizeCountry(country);
  if (!getCountryMeta(cc)) {
    throw new Error(`País ${cc} no está en el catálogo de Mercado Pago soportado.`);
  }
  const clientId = process.env[`MP_${cc}_CLIENT_ID`];
  const clientSecret = process.env[`MP_${cc}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    throw new Error(
      `Mercado Pago no está configurado para el país ${cc} (faltan MP_${cc}_CLIENT_ID / MP_${cc}_CLIENT_SECRET).`
    );
  }
  return { clientId, clientSecret, country: cc };
}

function redirectUri() {
  const uri = process.env.MP_REDIRECT_URI;
  if (!uri) throw new Error("MP_REDIRECT_URI no configurado en el servidor.");
  return uri;
}

/**
 * Construye la URL de autorización OAuth a la que se redirige al dueño del negocio
 * para que conecte su cuenta de Mercado Pago. Guarda un nonce anti-CSRF en la org.
 */
export async function buildAuthUrl(orgId) {
  const org = await Organization.findById(orgId).select("default_country").lean();
  if (!org) throw new Error("Organización no encontrada.");
  const { clientId, country } = appCreds(org.default_country);

  const nonce = crypto.randomBytes(16).toString("hex");
  const state = Buffer.from(JSON.stringify({ orgId: String(orgId), nonce })).toString("base64url");

  await Organization.findByIdAndUpdate(orgId, { "mpCollect.oauthState": nonce });

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    platform_id: "mp",
    state,
    redirect_uri: redirectUri(),
  });

  return { url: `${AUTH_BASE}?${params.toString()}`, country };
}

/**
 * Procesa el callback de OAuth: valida el state (anti-CSRF), intercambia el code
 * por tokens y persiste las credenciales de cobro de la org.
 */
export async function handleCallback(code, state) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    throw new Error("State inválido.");
  }
  const { orgId, nonce } = parsed || {};
  if (!orgId || !nonce) throw new Error("State incompleto.");

  const org = await Organization.findById(orgId).select("default_country mpCollect").lean();
  if (!org) throw new Error("Organización no encontrada.");
  if (!org.mpCollect?.oauthState || org.mpCollect.oauthState !== nonce) {
    throw new Error("State no coincide (posible CSRF o flujo expirado).");
  }

  const { clientId, clientSecret, country } = appCreds(org.default_country);

  const { data } = await axios.post(
    TOKEN_URL,
    {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
    },
    { headers: { "Content-Type": "application/json" } }
  );

  const expiresAt = new Date(Date.now() + Number(data.expires_in || 0) * 1000);

  await Organization.findByIdAndUpdate(orgId, {
    mpCollect: {
      connected: true,
      userId: String(data.user_id),
      accessToken: encryptSecret(data.access_token),
      refreshToken: encryptSecret(data.refresh_token),
      publicKey: data.public_key,
      scope: data.scope,
      site: country,
      tokenExpiresAt: expiresAt,
      connectedAt: new Date(),
      oauthState: null,
    },
  });

  return { orgId: String(orgId), userId: String(data.user_id), country };
}

/**
 * Refresca el access_token usando el refresh_token. MP devuelve un par NUEVO
 * (access + refresh), por lo que se re-guardan ambos. Devuelve true si refrescó.
 */
export async function refreshToken(orgId) {
  const org = await Organization.findById(orgId).select("default_country mpCollect").lean();
  if (!org?.mpCollect?.connected || !org.mpCollect.refreshToken) return false;

  const { clientId, clientSecret } = appCreds(org.default_country);

  const { data } = await axios.post(
    TOKEN_URL,
    {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: decryptSecret(org.mpCollect.refreshToken),
    },
    { headers: { "Content-Type": "application/json" } }
  );

  const expiresAt = new Date(Date.now() + Number(data.expires_in || 0) * 1000);

  await Organization.findByIdAndUpdate(orgId, {
    "mpCollect.accessToken": encryptSecret(data.access_token),
    "mpCollect.refreshToken": encryptSecret(data.refresh_token),
    "mpCollect.tokenExpiresAt": expiresAt,
    ...(data.scope ? { "mpCollect.scope": data.scope } : {}),
  });

  return true;
}

/**
 * Devuelve el access_token del VENDEDOR para crear cobros a su nombre. Si el
 * token está por expirar (<7 días) intenta refrescarlo primero. Lanza si la org
 * no está conectada.
 */
export async function getSellerToken(orgId) {
  let org = await Organization.findById(orgId).select("mpCollect").lean();
  if (!org?.mpCollect?.connected || !org.mpCollect.accessToken) {
    throw new Error("La organización no tiene Mercado Pago conectado.");
  }

  const expMs = org.mpCollect.tokenExpiresAt
    ? new Date(org.mpCollect.tokenExpiresAt).getTime()
    : 0;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  if (expMs && expMs - Date.now() < sevenDays) {
    try {
      await refreshToken(orgId);
      org = await Organization.findById(orgId).select("mpCollect").lean();
    } catch (e) {
      console.error("[getSellerToken] refresh falló, uso token actual:", e.message);
    }
  }

  return {
    accessToken: decryptSecret(org.mpCollect.accessToken),
    publicKey: org.mpCollect.publicKey,
    site: org.mpCollect.site,
  };
}

/**
 * Estado de conexión para el panel admin. NO devuelve tokens.
 */
export async function getStatus(orgId) {
  const org = await Organization.findById(orgId).select("mpCollect").lean();
  if (!org) throw new Error("Organización no encontrada.");
  const mp = org.mpCollect || {};
  return {
    connected: !!mp.connected,
    userId: mp.userId || null,
    site: mp.site || null,
    connectedAt: mp.connectedAt || null,
    tokenExpiresAt: mp.tokenExpiresAt || null,
  };
}

/**
 * Desconecta la cuenta de cobro (limpia credenciales). No revoca en MP; el dueño
 * puede volver a conectar cuando quiera.
 */
export async function disconnect(orgId) {
  await Organization.findByIdAndUpdate(orgId, { mpCollect: { connected: false } });
}
