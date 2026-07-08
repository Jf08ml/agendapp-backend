import sendResponse from "../utils/sendResponse.js";
import { sendMetaCapiEvent } from "../services/metaConversionsService.js";

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

    if (event_id) {
      const forwardedFor = req.headers["x-forwarded-for"];
      const clientIp = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor?.split(",")[0]?.trim();
      const userAgent = req.headers["user-agent"];
      const eventName = event_name || "CompleteRegistration";

      try {
        await sendMetaCapiEvent({
          eventName,
          eventId: event_id,
          eventSourceUrl: event_source_url,
          fbp,
          fbc,
          email,
          phone,
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
      console.warn("[metaConversionsController] Solicitud sin event_id; se ignora.");
    }

    sendResponse(res, 200, null, "ok");
  },
};

export default metaConversionsController;
