import sendResponse from "../utils/sendResponse.js";
import { sendCompleteRegistrationEvent } from "../services/metaConversionsService.js";

const metaConversionsController = {
  /**
   * POST /api/meta-capi/complete-registration
   * Recibe el evento CompleteRegistration desde el cliente (mismo event_id que
   * el Pixel, para dedup) y lo reenvía a la Conversions API de Meta con
   * advanced matching (email/teléfono hasheados server-side).
   * Nunca expone el token ni datos sensibles; siempre responde 200.
   */
  completeRegistration: async (req, res) => {
    const { event_id, event_source_url, fbp, fbc, email, phone } = req.body || {};

    if (event_id) {
      const forwardedFor = req.headers["x-forwarded-for"];
      const clientIp = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor?.split(",")[0]?.trim();
      const userAgent = req.headers["user-agent"];

      try {
        await sendCompleteRegistrationEvent({
          eventId: event_id,
          eventSourceUrl: event_source_url,
          fbp,
          fbc,
          email,
          phone,
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
