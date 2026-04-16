// controllers/paymentController.js
import paymentService from "../services/paymentService.js";
import sendResponse from "../utils/sendResponse.js";

const paymentController = {
  /**
   * POST /payments/checkout
   * Crear sesión de pago para el proveedor manual.
   * PayPal ya no usa este endpoint (los botones del SDK no necesitan crear sesión previa).
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
   * POST /payments/paypal/subscription-created
   * El frontend avisa que el usuario aprobó una suscripción en el popup de PayPal.
   * Se registra la sesión; la activación real llega con el webhook BILLING.SUBSCRIPTION.ACTIVATED.
   *
   * Body: { subscriptionId, planId, organizationId }
   */
  subscriptionCreated: async (req, res) => {
    try {
      const { subscriptionId, planId } = req.body;
      const organizationId = req.user?.organizationId || req.body.organizationId;

      if (!subscriptionId || !planId || !organizationId) {
        return sendResponse(res, 400, null, "Faltan campos: subscriptionId, planId, organizationId");
      }

      // Verificar que la suscripción existe en PayPal (ACTIVE o APPROVED)
      const provider = paymentService.getProvider("paypal");
      const verified = await provider.verifySubscription(subscriptionId);

      // Registrar la sesión (la activación la hace el webhook, esto es solo el registro)
      const session = await paymentService.recordSubscription({
        subscriptionId,
        organizationId,
        planId,
        amount: verified.amount,
        currency: verified.currency,
      });

      sendResponse(res, 200, { session, subscriptionId }, "Suscripción registrada, esperando activación");
    } catch (error) {
      console.error("[Payment] Error registrando suscripción PayPal:", error);
      sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * POST /payments/paypal/order-captured
   * El frontend capturó un pago único via actions.order.capture() del SDK.
   * El backend verifica la captura en PayPal y activa la membresía de inmediato.
   *
   * Body: { orderId, planId, organizationId }
   */
  orderCaptured: async (req, res) => {
    try {
      const { orderId, planId } = req.body;
      const organizationId = req.user?.organizationId || req.body.organizationId;

      if (!orderId || !planId || !organizationId) {
        return sendResponse(res, 400, null, "Faltan campos: orderId, planId, organizationId");
      }

      // Verificar captura en PayPal
      const provider = paymentService.getProvider("paypal");
      const parsed = await provider.verifyOrderCapture(orderId);

      // Activar membresía (idempotente gracias al eventId)
      const result = await paymentService.recordOrderCapture({
        orderId,
        organizationId,
        planId,
        amount: parsed.amount,
        currency: parsed.currency,
        eventId: parsed.eventId,
        raw: parsed.raw,
      });

      if (result.alreadyProcessed) {
        return sendResponse(res, 200, result, "Pago ya procesado previamente");
      }
      sendResponse(res, 200, result, "Pago único activado exitosamente");
    } catch (error) {
      console.error("[Payment] Error procesando pago único PayPal:", error);
      sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * POST /payments/manual-confirm
   * Superadmin confirma un pago manual.
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
   * Recibir webhooks de PayPal y otros proveedores.
   * parseWebhook puede ser async (PayPal requiere llamada a la API para verificar firma).
   *
   *   200: evento procesado o ya procesado (idempotente)
   *   400: firma inválida o payload malformado (no reintentar)
   *   500: error temporal (DB caída) → proveedor reintenta
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
        // await es necesario porque parseWebhook puede ser async (PayPal)
        parsed = await provider.parseWebhook(req.headers, req.body, req.rawBody);
      } catch (parseError) {
        console.error(`[Payment] Error parseando webhook ${providerName}:`, parseError.message);
        return res.status(400).json({ error: "Invalid webhook payload" });
      }

      // Eventos ignorados (ej. CHECKOUT.ORDER.APPROVED, tipos no soportados)
      if (parsed.status === "ignored" || !parsed.sessionId) {
        return res.status(200).json({ received: true, ignored: true });
      }

      const result = await paymentService.processPaymentEvent({
        provider: providerName,
        ...parsed,
      });

      res.status(200).json({ received: true, alreadyProcessed: result.alreadyProcessed });
    } catch (error) {
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
