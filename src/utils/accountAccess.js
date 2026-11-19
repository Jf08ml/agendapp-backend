// Piezas puras de la recuperación de acceso del dueño (sin BD ni red), para
// poder probarlas con `node --test`. El flujo completo vive en
// services/accountAccessService.js.

import crypto from "crypto";
import { MAIN_DOMAIN } from "./panelLinks.js";

export const ACCESS_CODE_TTL_MINUTES = 10;
export const ACCESS_MAX_ATTEMPTS = 5;
export const ACCESS_RESEND_COOLDOWN_SECONDS = 60;
export const ACCESS_MAX_SENDS_PER_HOUR = 5;
// Tras verificar el código, el dueño tiene este tiempo para elegir contraseña
// nueva o entrar sin cambiarla.
export const ACCESS_COMPLETE_TTL_MINUTES = 15;
// Igual que el registro (SignupPage: min 6).
export const MIN_PASSWORD_LENGTH = 6;

// Plantillas del número Oficina IA (ACCESS_WA_LINE en panelLinks.js).
// codigo_acceso: categoría Autenticación (texto fijo de Meta + botón "Copiar código").
// aviso_cuenta: categoría Utilidad; sin "contraseña/acceso/inicia sesión" en el
// texto o Meta la reclasifica como Autenticación.
export const ACCESS_CODE_WA_TEMPLATE = "codigo_acceso";
export const ACCOUNT_NOTICE_WA_TEMPLATE = "aviso_cuenta";

const onlyDigits = (v) => String(v ?? "").replace(/\D/g, "");

/** sha256 en hex: los códigos y enlaces nunca se guardan en claro. */
export function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

/** Código numérico de 6 dígitos (con ceros a la izquierda). */
export function generateAccessCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Token aleatorio para enlaces (correo) y para completar el acceso. */
export function generateAccessToken() {
  return crypto.randomBytes(32).toString("hex");
}

/** Comparación en tiempo constante de dos hashes hex. */
export function sameHash(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Qué escribió la persona: correo o celular. Devuelve null si no parece
 * ninguno de los dos.
 * @returns {{ type: "email", value: string } | { type: "phone", value: string } | null}
 */
export function parseIdentifier(raw) {
  const value = String(raw ?? "").replace(/\s+/g, "").trim();
  if (!value) return null;
  if (value.includes("@")) {
    const email = value.toLowerCase();
    return /^[^@]+@[^@]+\.[^@]+$/.test(email) ? { type: "email", value: email } : null;
  }
  const digits = onlyDigits(value);
  // Mínimo 7 dígitos para no buscar con números incompletos.
  return digits.length >= 7 && digits.length <= 15 ? { type: "phone", value: digits } : null;
}

/**
 * Últimos 10 dígitos de un teléfono: tolera que falte o sobre el indicativo
 * (mismo criterio que get_my_appointments del chatbot de reservas).
 */
export function phoneMatchKey(phone) {
  const digits = onlyDigits(phone);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** jua•••@gmail.com — muestra lo justo para que el dueño reconozca su correo. */
export function maskEmail(email) {
  const value = String(email ?? "").trim();
  const at = value.lastIndexOf("@");
  if (at <= 0) return "•••";
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, Math.min(3, local.length - 2));
  return `${visible}•••@${domain}`;
}

/** +57 ••• ••• 5187 — solo el indicativo (si viene en E.164) y los últimos 4. */
export function maskPhone(phone) {
  const raw = String(phone ?? "").trim();
  const digits = onlyDigits(raw);
  if (digits.length < 4) return "•••";
  const last4 = digits.slice(-4);
  if (raw.startsWith("+") && digits.length > 10) {
    const cc = digits.slice(0, digits.length - 10);
    return `+${cc} ••• ••• ${last4}`;
  }
  return `••• ••• ${last4}`;
}

/**
 * Componentes de `codigo_acceso` (Autenticación con botón "Copiar código"):
 * el código va en el body ({{1}}) y otra vez en el botón de URL índice 0.
 */
export function codigoAccesoComponents(code) {
  const text = String(code);
  return [
    { type: "body", parameters: [{ type: "text", text }] },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text }] },
  ];
}

/**
 * Componentes de `aviso_cuenta` (Utilidad):
 *   {{1}} nombre del dueño · {{2}} negocio · {{3}} fecha y hora del cambio
 */
export function avisoCuentaComponents({ ownerName, businessName, when }) {
  const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim() || "—";
  return [
    {
      type: "body",
      parameters: [ownerName, businessName, when].map((t) => ({ type: "text", text: clean(t) })),
    },
  ];
}

/**
 * Por qué canales se le puede mandar el código a un dueño. El correo deja de
 * ofrecerse si rebotó (ownerEmailBounce con la misma dirección que tiene hoy).
 * @param {{ email?: string, phoneNumber?: string, ownerEmailBounce?: { address?: string } }} org
 */
export function accessChannelsFor(org) {
  const channels = [];
  const email = String(org?.email ?? "").trim().toLowerCase();
  const bouncedAddress = String(org?.ownerEmailBounce?.address ?? "").trim().toLowerCase();
  if (email) {
    const bounced = Boolean(bouncedAddress) && bouncedAddress === email;
    channels.push({ channel: "email", masked: maskEmail(email), available: !bounced, ...(bounced && { reason: "bounced" }) });
  }
  if (onlyDigits(org?.phoneNumber).length >= 7) {
    channels.push({ channel: "whatsapp", masked: maskPhone(org.phoneNumber), available: true });
  }
  return channels;
}

/**
 * Página de recuperación en el dominio del negocio (subdominio, o su dominio
 * propio si no tiene slug). En local, FRONTEND_BASE_URL con ?slug= para el tenant.
 * @param {{ slug?: string, domains?: string[] }} org
 * @param {string} query - p. ej. "c=<id>&t=<token>"
 * @param {{ nodeEnv?: string, frontendBaseUrl?: string }} [env] - inyectable para pruebas
 */
export function accessPageUrl(org, query, env = {}) {
  const nodeEnv = env.nodeEnv ?? process.env.NODE_ENV;
  if (nodeEnv !== "production") {
    const base = String(env.frontendBaseUrl ?? process.env.FRONTEND_BASE_URL ?? "http://localhost:5173").replace(/\/+$/, "");
    return `${base}/recuperar-acceso?${query}${org?.slug ? `&slug=${org.slug}` : ""}`;
  }
  const host = org?.slug ? `${org.slug}.${MAIN_DOMAIN}` : org?.domains?.[0] || `app.${MAIN_DOMAIN}`;
  return `https://${host}/recuperar-acceso?${query}`;
}
