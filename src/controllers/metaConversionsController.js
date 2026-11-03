import sendResponse from "../utils/sendResponse.js";
import getClientIp from "../utils/getClientIp.js";
import { sanitizeBrowserEvent, sendMetaCapiEvent } from "../services/metaConversionsService.js";

// Ruta pública: solo se reenvían los eventos que el frontend dispara de verdad
// (src/services/metaConversionsService.ts). Lo demás se descarta, para que nadie
// pueda meter eventos falsos en el píxel.
//
// CompleteRegistration ya no entra por aquí: lo envía el propio registro
// (registrationController.register) cuando la cuenta se crea de verdad. Antes
// cualquiera podía mandar un registro falso con un correo inventado, y las
// campañas que optimizan por el registro aprenderían de esos eventos.
const ALLOWED_CONTACT_NAMES = new Set(["flotante_app"]);

function str(value, max = 300) {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : undefined;
}

function knownIp(req) {
  const ip = getClientIp(req);
  return ip === "unknown" ? undefined : ip;
}

const metaConversionsController = {
  /**
   * POST /api/meta-capi/complete-registration
   * (El nombre de la ruta se mantiene para no romper el frontend desplegado.)
   * Reenvía a la Conversions API el evento "Contact" de los botones flotantes
   * de WhatsApp (content_name "flotante_app"), con el mismo event_id que el
   * Pixel para deduplicar. Sin datos personales. Siempre responde 200.
   */
  completeRegistration: async (req, res) => {
    const { event_name, content_name } = req.body || {};
    const browser = sanitizeBrowserEvent(req.body);
    const allowed = str(event_name) === "Contact" && ALLOWED_CONTACT_NAMES.has(content_name);

    if (allowed && browser) {
      try {
        await sendMetaCapiEvent({
          eventName: "Contact",
          ...browser,
          customData: { content_name },
          clientIp: knownIp(req),
          userAgent: str(req.headers["user-agent"], 500),
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
