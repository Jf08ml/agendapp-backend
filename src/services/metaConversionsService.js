import axios from "axios";
import { createHash } from "crypto";

const GRAPH_API_VERSION = "v21.0";

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
 * Envía el evento estándar CompleteRegistration a la Conversions API de Meta.
 * Nunca lanza: los errores se registran y el llamador siempre responde 200
 * (el registro de la organización ya se completó; esto es solo tracking).
 */
export async function sendCompleteRegistrationEvent({
  eventId,
  eventSourceUrl,
  fbp,
  fbc,
  email,
  phone,
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

  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhoneDigits(phone);

  const userData = {
    ...(normalizedEmail && { em: [sha256(normalizedEmail)] }),
    ...(normalizedPhone && { ph: [sha256(normalizedPhone)] }),
    ...(clientIp && { client_ip_address: clientIp }),
    ...(userAgent && { client_user_agent: userAgent }),
    ...(fbp && { fbp }),
    ...(fbc && { fbc }),
  };

  const event = {
    event_name: "CompleteRegistration",
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "website",
    ...(eventSourceUrl && { event_source_url: eventSourceUrl }),
    user_data: userData,
    custom_data: { status: true },
  };

  const body = {
    data: [event],
    ...(process.env.META_CAPI_TEST_EVENT_CODE && {
      test_event_code: process.env.META_CAPI_TEST_EVENT_CODE,
    }),
  };

  try {
    await axios.post(`https://graph.facebook.com/${GRAPH_API_VERSION}/${pixelId}/events`, body, {
      params: { access_token: accessToken },
    });
  } catch (err) {
    console.error(
      "[metaConversions] Error enviando CompleteRegistration a CAPI:",
      err.response?.data || err.message
    );
  }
}
