// Reseñas en Google: piezas puras (sin BD ni red) para el pedido de reseña por
// WhatsApp después de la cita (cron/googleReviewRequestJob.js) y el perfil de
// Google del negocio (Organization.googleBusiness). Probadas con `node --test`.

import moment from "moment-timezone";

// La cita debe haber terminado hace al menos esto antes de pedir la reseña…
export const REVIEW_DELAY_HOURS = 2;
// …y como mucho hace esto (al activar la función no se le escribe a todo el historial).
export const REVIEW_MAX_AGE_HOURS = 48;
// Un mismo cliente recibe como máximo un pedido de reseña en este periodo.
export const REVIEW_COOLDOWN_DAYS = 180;
// Franja horaria (hora del negocio) en la que se envía: nada de mensajes de noche.
export const REVIEW_SEND_FROM_HOUR = 9;
export const REVIEW_SEND_UNTIL_HOUR = 20;

/** Place ID de Google: letras, números, "_" y "-" (normalmente empieza por "ChIJ"). */
export function isValidPlaceId(placeId) {
  return typeof placeId === "string" && /^[A-Za-z0-9_-]{10,300}$/.test(placeId.trim());
}

/** Enlace que abre directamente el formulario para dejar una reseña del negocio. */
export function googleReviewUrl(placeId) {
  if (!isValidPlaceId(placeId)) return null;
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId.trim())}`;
}

/** ¿Es hora de enviar en la zona horaria del negocio? (9:00–19:59) */
export function isWithinSendingHours(now, tz) {
  const hour = moment(now).tz(tz || "America/Bogota").hour();
  return hour >= REVIEW_SEND_FROM_HOUR && hour < REVIEW_SEND_UNTIL_HOUR;
}

/** Rango de `endDate` de las citas candidatas. */
export function candidateWindow(now) {
  const t = new Date(now).getTime();
  return {
    from: new Date(t - REVIEW_MAX_AGE_HOURS * 3600 * 1000),
    to: new Date(t - REVIEW_DELAY_HOURS * 3600 * 1000),
  };
}

/**
 * Decide qué citas atendidas reciben el pedido de reseña. Un mensaje por
 * cliente (la cita más reciente de la visita); el resto queda resuelto con su
 * motivo para no volver a evaluarlo.
 *
 * @param {Array<{ _id, endDate: Date|string, client?: { _id, phone_e164?: string, googleReviewRequestedAt?: Date|string|null } }>} appts
 * @param {{ now: Date }} opts
 * @returns {{ toSend: object[], skipped: Array<{ appt: object, outcome: string }> }}
 */
export function selectReviewCandidates(appts, { now }) {
  const cooldownMs = REVIEW_COOLDOWN_DAYS * 24 * 3600 * 1000;
  const nowMs = new Date(now).getTime();
  const toSend = [];
  const skipped = [];

  const byClient = new Map();
  for (const appt of appts) {
    const clientId = appt.client?._id ? String(appt.client._id) : null;
    if (!clientId) {
      skipped.push({ appt, outcome: "skipped_no_phone" });
      continue;
    }
    if (!byClient.has(clientId)) byClient.set(clientId, []);
    byClient.get(clientId).push(appt);
  }

  for (const list of byClient.values()) {
    list.sort((a, b) => new Date(b.endDate) - new Date(a.endDate));
    const [latest, ...rest] = list;
    for (const appt of rest) skipped.push({ appt, outcome: "skipped_same_visit" });

    const client = latest.client;
    if (!client.phone_e164) {
      skipped.push({ appt: latest, outcome: "skipped_no_phone" });
      continue;
    }
    const lastAsked = client.googleReviewRequestedAt ? new Date(client.googleReviewRequestedAt).getTime() : null;
    if (lastAsked && nowMs - lastAsked < cooldownMs) {
      skipped.push({ appt: latest, outcome: "skipped_recent" });
      continue;
    }
    toSend.push(latest);
  }

  return { toSend, skipped };
}
