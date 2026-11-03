import axios from "axios";
import { createHash } from "crypto";

const GRAPH_API_VERSION = "v26.0";

const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Formato de las cookies _fbp y _fbc: fb.<subdominio>.<timestamp>.<valor>
const FB_COOKIE = /^fb\.\d\.\d{10,16}\.[A-Za-z0-9_.-]{1,200}$/;

function str(value, max = 300) {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : undefined;
}

function sameSiteUrl(value) {
  const raw = str(value, 1000);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && (url.hostname === "agenditapp.com" || url.hostname.endsWith(".agenditapp.com"))
      ? raw
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Datos del navegador que acompañan un evento: el event_id (el mismo que usa
 * el Pixel, para que Meta no cuente el evento dos veces), la URL y las
 * cookies _fbp/_fbc. Todo saneado; null si no hay un event_id válido.
 */
export function sanitizeBrowserEvent(input) {
  const { event_id, event_source_url, fbp, fbc } = input || {};
  if (typeof event_id !== "string" || !EVENT_ID.test(event_id)) return null;
  return {
    eventId: event_id,
    eventSourceUrl: sameSiteUrl(event_source_url),
    fbp: FB_COOKIE.test(str(fbp) ?? "") ? fbp : undefined,
    fbc: FB_COOKIE.test(str(fbc) ?? "") ? fbc : undefined,
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(email) {
  return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : undefined;
}

// E.164 sin "+", solo dígitos, tal como lo requiere la Conversions API
function normalizePhoneDigits(phone) {
  if (typeof phone !== "string") return undefined;
  const digits = phone.replace(/\D/g, "");
  return digits || undefined;
}

/**
 * Envía un evento a la Conversions API de Meta. Soporta tanto el evento
 * estándar CompleteRegistration (con advanced matching email/teléfono
 * hasheados) como otros eventos sin datos personales (p.ej. Contact) — el
 * hashing de email/phone solo aplica cuando eventName es CompleteRegistration.
 * Nunca lanza: los errores se registran y el llamador siempre responde 200
 * (esto es solo tracking, nunca debe bloquear el flujo principal).
 */
export async function sendMetaCapiEvent({
  eventName,
  eventId,
  eventSourceUrl,
  fbp,
  fbc,
  email,
  phone,
  customData,
  clientIp,
  userAgent,
}) {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    console.warn(
      "[metaConversions] META_PIXEL_ID o META_CAPI_ACCESS_TOKEN no configurados; se omite el envío a CAPI."
    );
    return;
  }

  const isCompleteRegistration = eventName === "CompleteRegistration";
  const normalizedEmail = isCompleteRegistration ? normalizeEmail(email) : undefined;
  const normalizedPhone = isCompleteRegistration ? normalizePhoneDigits(phone) : undefined;

  const userData = {
    ...(normalizedEmail && { em: [sha256(normalizedEmail)] }),
    ...(normalizedPhone && { ph: [sha256(normalizedPhone)] }),
    ...(clientIp && { client_ip_address: clientIp }),
    ...(userAgent && { client_user_agent: userAgent }),
    ...(fbp && { fbp }),
    ...(fbc && { fbc }),
  };

  const event = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "website",
    ...(eventSourceUrl && { event_source_url: eventSourceUrl }),
    user_data: userData,
    custom_data: customData || {},
  };

  // El token va como campo del cuerpo, no en la URL (documentación de la
  // Conversions API: access_token). Así no queda en logs de URLs.
  const form = new FormData();
  form.set("data", JSON.stringify([event]));
  form.set("access_token", accessToken);
  if (process.env.META_CAPI_TEST_EVENT_CODE) {
    form.set("test_event_code", process.env.META_CAPI_TEST_EVENT_CODE);
  }

  try {
    await axios.post(`https://graph.facebook.com/${GRAPH_API_VERSION}/${pixelId}/events`, form, {
      timeout: 5000,
    });
  } catch (err) {
    console.error(
      `[metaConversions] Error enviando ${eventName} a CAPI:`,
      err.response?.data || err.message
    );
  }
}
