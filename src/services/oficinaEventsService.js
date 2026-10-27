import { createHmac } from "crypto";

/**
 * Eventos de conversión hacia AgenditApp Oficina IA (contrato en
 * agenditapp-oficina/docs/CONVERSIONES.md).
 *
 * - Firmados con HMAC-SHA256 (OFICINA_EVENTS_SECRET), sin datos personales:
 *   solo ids internos, tipo, fecha, UTM y, en los pagos, importe y moneda.
 * - Nunca lanza ni bloquea: espera como mucho 2 s y, si falla, lo registra.
 *   Se AWAITea a propósito: en Vercel la instancia se congela al responder y
 *   una petición en vuelo se perdería.
 * - Sin OFICINA_EVENTS_URL u OFICINA_EVENTS_SECRET no hace nada.
 * - El eventId es determinista: si se envía dos veces, la Oficina lo guarda una.
 */

const TIMEOUT_MS = 2000;

const ATTRIBUTION_KEYS = {
  utm_source: "utmSource",
  utm_medium: "utmMedium",
  utm_campaign: "utmCampaign",
  utm_content: "utmContent",
  utm_term: "utmTerm",
  fbclid: "fbclid",
};

/**
 * Normaliza la atribución que llega del navegador: solo claves conocidas,
 * texto recortado y con tope de longitud. Devuelve undefined si no hay nada.
 */
export function sanitizeAttribution(input) {
  if (!input || typeof input !== "object") return undefined;
  const out = {};
  for (const [raw, key] of Object.entries(ATTRIBUTION_KEYS)) {
    const value = input[raw] ?? input[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, key === "fbclid" ? 500 : 200);
    if (trimmed) out[key] = trimmed;
  }
  return Object.keys(out).length ? out : undefined;
}

async function sendOficinaEvent(event) {
  const url = process.env.OFICINA_EVENTS_URL;
  const secret = process.env.OFICINA_EVENTS_SECRET;
  if (!url || !secret) return;

  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/api/v1/conversions/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Oficina-Signature": `t=${t},v1=${v1}` },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[oficinaEvents] ${event.type} ${event.eventId}: HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`[oficinaEvents] ${event.type} ${event.eventId}: ${err?.message || err}`);
  }
}

/** Id de la organización como texto: acepta un ObjectId, su texto o un documento poblado. */
const idOf = (organizationId) => String(organizationId?._id ?? organizationId);

const base = (type, prefix, organizationId, occurredAt = new Date()) => ({
  eventId: `${prefix}:${idOf(organizationId)}`,
  type,
  occurredAt: new Date(occurredAt).toISOString(),
  organizationId: idOf(organizationId),
});

export function emitSignupCompleted({ organizationId, attribution, occurredAt }) {
  const event = base("signup_completed", "signup", organizationId, occurredAt);
  const clean = sanitizeAttribution(attribution);
  return sendOficinaEvent(clean ? { ...event, attribution: clean } : event);
}

export function emitBusinessActivated({ organizationId, occurredAt }) {
  return sendOficinaEvent(base("business_activated", "activated", organizationId, occurredAt));
}

export function emitFirstBooking({ organizationId, occurredAt }) {
  return sendOficinaEvent(base("first_booking", "first-booking", organizationId, occurredAt));
}

/** Pago confirmado por el webhook. `providerEventId` es el id del evento del proveedor (idempotencia). */
export function emitSubscriptionPaid({ organizationId, provider, providerEventId, amount, currency, firstPayment, occurredAt }) {
  if (!Number.isFinite(Number(amount)) || !/^[A-Z]{3}$/.test(String(currency || "").toUpperCase())) return Promise.resolve();
  // El id del evento del proveedor hace el pago idempotente; sin él no se envía.
  if (!providerEventId) return Promise.resolve();
  const eventId = `paid:${provider}:${providerEventId}`.slice(0, 128).replace(/[^A-Za-z0-9:_.-]/g, "-");
  return sendOficinaEvent({
    ...base("subscription_paid", "paid", organizationId, occurredAt),
    eventId,
    value: { amount: Number(amount), currency: String(currency).toUpperCase() },
    firstPayment: Boolean(firstPayment),
  });
}
