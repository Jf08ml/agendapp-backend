// controllers/paymentController.js
import paymentService from "../services/paymentService.js";
import { runPaypalSubscriptionSync } from "../cron/paypalSubscriptionSyncJob.js";
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
    const { provider: providerName } = req.params;
    const eventType = req.body?.event_type || "unknown";
    const eventId = req.body?.id || "no-id";
    console.log(`[Webhook] ▶ ${providerName} | ${eventType} | id=${eventId}`);

    try {
      let provider;
      try {
        provider = paymentService.getProvider(providerName);
      } catch {
        console.warn(`[Webhook] Provider no soportado: ${providerName}`);
        return res.status(400).json({ error: `Provider "${providerName}" not supported` });
      }

      let parsed;
      try {
        parsed = await provider.parseWebhook(req.headers, req.body, req.rawBody);
      } catch (parseError) {
        console.error(`[Webhook] Error parseando ${providerName}/${eventType}:`, parseError.message);
        return res.status(400).json({ error: "Invalid webhook payload" });
      }

      if (parsed.status === "ignored" || !parsed.sessionId) {
        console.log(`[Webhook] Ignorado: ${eventType}`);
        return res.status(200).json({ received: true, ignored: true });
      }

      console.log(`[Webhook] Procesando: sessionId=${parsed.sessionId} status=${parsed.status}`);
      const result = await paymentService.processPaymentEvent({
        provider: providerName,
        ...parsed,
      });

      if (result.alreadyProcessed) {
        console.log(`[Webhook] Ya procesado: ${parsed.eventId}`);
      } else {
        console.log(`[Webhook] ✓ Completado: ${parsed.eventId}`);
      }

      res.status(200).json({ received: true, alreadyProcessed: result.alreadyProcessed });
    } catch (error) {
      console.error(`[Webhook] ✗ Error ${providerName}/${eventType}:`, error.message, error.stack);
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

  /**
   * POST /payments/paypal/renew-by-subscription
   * Superadmin: registra manualmente un pago de renovación para una suscripción PayPal.
   * Útil cuando el webhook PAYMENT.SALE.COMPLETED no llegó (URL incorrecta, etc.).
   *
   * Body: { subscriptionId, amount, currency? }
   * Busca la membresía por paypalSubscriptionId y la renueva usando el billingCycle del plan.
   */
  renewBySubscription: async (req, res) => {
    try {
      const { subscriptionId, amount, currency } = req.body;

      if (!subscriptionId || !amount) {
        return sendResponse(res, 400, null, "subscriptionId y amount son requeridos");
      }

      // eventId único para que sea idempotente pero no colisione con webhooks reales
      const eventId = `manual_renewal_${subscriptionId}_${Date.now()}`;

      const result = await paymentService.processPaymentEvent({
        provider: "paypal",
        eventId,
        type: "PAYMENT.SALE.COMPLETED",
        sessionId: `sub_${subscriptionId}`,
        amount: parseFloat(amount),
        currency: (currency || "USD").toUpperCase(),
        status: "succeeded",
        subscriptionId,
        paymentMode: "subscription",
        raw: { manual: true, renewedBy: req.user?.id, renewedAt: new Date() },
      });

      if (result.alreadyProcessed) {
        return sendResponse(res, 200, result, "Esta renovación ya fue procesada");
      }

      sendResponse(res, 200, result, `Membresía renovada para suscripción ${subscriptionId}`);
    } catch (error) {
      console.error("[Payment] Error en renovación manual por subscriptionId:", error);
      sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * GET /payments/paypal/diagnose
   * Superadmin: verifica la configuración de PayPal (OAuth, webhooks, eventos suscritos).
   * No modifica nada, solo consulta la API de PayPal y reporta problemas.
   */
  diagnosePaypal: async (req, res) => {
    try {
      const provider = paymentService.getProvider("paypal");
      const backendUrl = process.env.BACKEND_URL || process.env.VERCEL_URL || "";
      const result = await provider.diagnose(backendUrl);
      sendResponse(res, 200, result, result.ok ? "Configuración OK" : "Se encontraron problemas");
    } catch (error) {
      console.error("[Payment] Error en diagnóstico PayPal:", error);
      sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * POST /payments/paypal/sync-subscriptions
   * Superadmin: ejecutar manualmente el sync activo de suscripciones PayPal.
   * Útil para activar membresías cuyo webhook nunca llegó.
   */
  syncPaypalSubscriptions: async (req, res) => {
    try {
      const result = await runPaypalSubscriptionSync();
      sendResponse(res, 200, result, "Sync de suscripciones completado");
    } catch (error) {
      console.error("[Payment] Error en sync manual de suscripciones:", error);
      sendResponse(res, 500, null, error.message);
    }
  },
};

export default paymentController;
