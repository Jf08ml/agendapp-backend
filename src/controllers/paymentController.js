// controllers/paymentController.js
import paymentService from "../services/paymentService.js";
import sendResponse from "../utils/sendResponse.js";

const paymentController = {
  /**
   * POST /payments/checkout
   * Crear sesión de pago (para cualquier provider)
   */
  createCheckout: async (req, res) => {
    try {
      const { provider, planId, membershipId, amount, currency, successUrl, cancelUrl } = req.body;
      const organizationId = req.user?.organizationId || req.body.organizationId;

      if (!provider || !planId || !organizationId) {
        return sendResponse(res, 400, null, "Faltan campos: provider, planId, organizationId");
      }

      const session = await paymentService.createCheckoutSession({
        provider,
        organizationId,
        planId,
        membershipId,
        amount,
        currency,
        successUrl,
        cancelUrl,
      });

      sendResponse(res, 201, session, "Sesión de pago creada");
    } catch (error) {
      console.error("[Payment] Error creando checkout:", error);
      sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * POST /payments/manual-confirm
   * Superadmin confirma un pago manual (equivalente a webhook).
   * Requiere manualPaymentId para idempotencia determinística.
   */
  confirmManualPayment: async (req, res) => {
    try {
      const { sessionId, manualPaymentId, amount, currency, adminNotes } = req.body;

      if (!sessionId || !manualPaymentId) {
        return sendResponse(res, 400, null, "Faltan sessionId y manualPaymentId");
      }

      const provider = paymentService.getProvider("manual");
      const parsed = provider.parseWebhook({}, { manualPaymentId, sessionId, amount, currency, adminNotes });

      const result = await paymentService.processPaymentEvent({
        provider: "manual",
        ...parsed,
      });

      if (result.alreadyProcessed) {
        return sendResponse(res, 200, result, "Este pago ya fue procesado anteriormente");
      }

      sendResponse(res, 200, result, "Pago manual confirmado");
    } catch (error) {
      console.error("[Payment] Error confirmando pago manual:", error);
      sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * POST /payments/webhook/:provider
   * Recibir webhooks de proveedores externos.
   * Respuestas HTTP según caso:
   *   - 200: evento procesado o ya procesado (idempotente)
   *   - 400: firma inválida o parseo fallido
   *   - 500: error temporal (DB caída) → provider reintenta
   */
  handleWebhook: async (req, res) => {
    try {
      const { provider: providerName } = req.params;

      let provider;
      try {
        provider = paymentService.getProvider(providerName);
      } catch {
        return res.status(400).json({ error: `Provider "${providerName}" not supported` });
      }

      let parsed;
      try {
        parsed = provider.parseWebhook(req.headers, req.body);
      } catch (parseError) {
        // Firma inválida o payload malformado → 400, no reintentar
        console.error(`[Payment] Error parseando webhook ${providerName}:`, parseError.message);
        return res.status(400).json({ error: "Invalid webhook payload" });
      }

      const result = await paymentService.processPaymentEvent({
        provider: providerName,
        ...parsed,
      });

      res.status(200).json({ received: true, alreadyProcessed: result.alreadyProcessed });
    } catch (error) {
      // Error temporal (DB, etc.) → 500 para que provider reintente
      console.error(`[Payment] Error en webhook ${req.params.provider}:`, error);
      res.status(500).json({ error: "Internal processing error" });
    }
  },

  /**
   * GET /payments/history/:organizationId
   */
  getPaymentHistory: async (req, res) => {
    try {
      const { organizationId } = req.params;
      const sessions = await paymentService.getPaymentHistory(organizationId);
      sendResponse(res, 200, sessions, "Historial de pagos");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },
};

export default paymentController;
