import sendResponse from "../utils/sendResponse.js";
import { sendMetaCapiEvent } from "../services/metaConversionsService.js";

// Ruta pública: solo se reenvían los eventos que el frontend dispara de verdad
// (src/services/metaConversionsService.ts). Lo demás se descarta, para que nadie
// pueda meter eventos falsos en el píxel.
const ALLOWED_CONTACT_NAMES = new Set(["flotante_app"]);
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Formato de las cookies _fbp y _fbc: fb.<subdominio>.<timestamp>.<valor>
const FB_COOKIE = /^fb\.\d\.\d{10,16}\.[A-Za-z0-9_.-]{1,200}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

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

const metaConversionsController = {
  /**
   * POST /api/meta-capi/complete-registration
   * Recibe un evento desde el cliente (mismo event_id que el Pixel, para
   * dedup) y lo reenvía a la Conversions API de Meta. Soporta event_name
   * parametrizado — default "CompleteRegistration" (con advanced matching
   * email/teléfono hasheados server-side) — para reusar el mismo endpoint
   * con otros eventos estándar sin datos personales (p.ej. "Contact" desde
   * los botones flotantes de WhatsApp, content_name "flotante_app").
   * Nunca expone el token ni datos sensibles; siempre responde 200.
   */
  completeRegistration: async (req, res) => {
    const {
      event_id,
      event_source_url,
      fbp,
      fbc,
      email,
      phone,
      event_name,
      content_name,
    } = req.body || {};

    const eventName = str(event_name) || "CompleteRegistration";
    const allowed =
      eventName === "CompleteRegistration" ||
      (eventName === "Contact" && ALLOWED_CONTACT_NAMES.has(content_name));
    const validEmail = str(email, 254) && EMAIL.test(email.trim()) ? email : undefined;

    if (allowed && typeof event_id === "string" && EVENT_ID.test(event_id)) {
      const forwardedFor = req.headers["x-forwarded-for"];
      const clientIp = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor?.split(",")[0]?.trim();
      const userAgent = str(req.headers["user-agent"], 500);

      try {
        await sendMetaCapiEvent({
          eventName,
          eventId: event_id,
          eventSourceUrl: sameSiteUrl(event_source_url),
          fbp: FB_COOKIE.test(str(fbp) ?? "") ? fbp : undefined,
          fbc: FB_COOKIE.test(str(fbc) ?? "") ? fbc : undefined,
          email: validEmail,
          phone: str(phone, 30),
          customData:
            eventName === "CompleteRegistration"
              ? { status: true }
              : { content_name },
          clientIp,
          userAgent,
        });
      } catch (err) {
        console.error("[metaConversionsController] Error inesperado:", err.message);
      }
    } else {
      console.warn("[metaConversionsController] Evento no permitido o sin event_id válido; se ignora.");
    }

    sendResponse(res, 200, null, "ok");
  },
};

export default metaConversionsController;
