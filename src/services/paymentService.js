// services/paymentService.js
import PaymentSession from "../models/paymentSessionModel.js";
import PaymentEvent from "../models/paymentEventModel.js";
import membershipService from "./membershipService.js";
import ManualPaymentProvider from "./paymentProviders/ManualPaymentProvider.js";
import LemonSqueezyPaymentProvider from "./paymentProviders/LemonSqueezyPaymentProvider.js";

// Registry de providers
const providers = {
  manual: new ManualPaymentProvider(),
  lemonsqueezy: new LemonSqueezyPaymentProvider(),
  // stripe: new StripePaymentProvider(),  ← futuro
};

const paymentService = {
  getProvider(name) {
    const provider = providers[name];
    if (!provider) throw new Error(`Payment provider "${name}" not registered`);
    return provider;
  },

  /**
   * Crear sesión de pago (checkout)
   */
  async createCheckoutSession({ provider: providerName, organizationId, planId, membershipId, amount, currency, successUrl, cancelUrl, variantId }) {
    const provider = this.getProvider(providerName);

    const result = await provider.createCheckout({
      organizationId, planId, amount, currency, successUrl, cancelUrl, variantId,
    });

    const session = await PaymentSession.create({
      provider: providerName,
      sessionId: result.sessionId,
      checkoutUrl: result.checkoutUrl,
      organizationId,
      planId,
      membershipId,
      amount,
      currency: currency || "USD",
      status: "created",
      rawCreateResponse: result.rawResponse,
    });

    return session;
  },

  /**
   * Procesar webhook/confirmación (IDEMPOTENTE).
   * Orden crítico: activar membresía ANTES de crear el PaymentEvent.
   * Si la activación falla, el PaymentEvent no se crea → el provider puede reintentar.
   */
  async processPaymentEvent({ provider: providerName, eventId, type, sessionId, amount, currency, status, raw }) {
    // 1. Idempotencia: si el PaymentEvent ya existe, fue procesado correctamente
    const existingEvent = await PaymentEvent.findOne({ provider: providerName, eventId });
    if (existingEvent) {
      console.log(`[Payment] Evento ${providerName}:${eventId} ya procesado, ignorando`);
      return { alreadyProcessed: true, event: existingEvent };
    }

    // 2. Buscar la sesión de pago
    const session = await PaymentSession.findOne({ sessionId });
    if (!session) {
      console.error(`[Payment] Sesión ${sessionId} no encontrada`);
      throw new Error(`Payment session ${sessionId} not found`);
    }

    // 3. Activar membresía PRIMERO (antes del PaymentEvent para permitir reintentos)
    //    Si esto lanza, el PaymentEvent NO se crea → el provider puede reintentar
    if (status === "succeeded") {
      console.log(`[Payment] Activando membresía para org ${session.organizationId}, plan ${session.planId}`);
      await membershipService.activatePaidPlan({
        organizationId: session.organizationId,
        planId: session.planId,
        paymentAmount: amount || session.amount,
      });
      console.log(`[Payment] Membresía activada para org ${session.organizationId}`);
    }

    // 4. Registrar el evento como idempotency marker (DESPUÉS de activación exitosa)
    let event;
    try {
      event = await PaymentEvent.create({
        provider: providerName,
        eventId,
        type,
        sessionId,
        organizationId: session.organizationId,
        planId: session.planId,
        membershipId: session.membershipId,
        amount: amount || session.amount,
        currency: currency || session.currency,
        status,
        raw,
      });
    } catch (err) {
      // Duplicate key: una request concurrente ya procesó este evento
      if (err.code === 11000) {
        const ev = await PaymentEvent.findOne({ provider: providerName, eventId });
        return { alreadyProcessed: true, event: ev };
      }
      throw err;
    }

    // 5. Actualizar estado de la sesión
    if (status === "succeeded") {
      session.status = "succeeded";
      session.processed = true;
      session.processedAt = new Date();
      session.processedEventIds.push(eventId);
      await session.save();
    } else if (status === "failed") {
      session.status = "failed";
      session.processed = true;
      session.processedAt = new Date();
      await session.save();
    }

    return { alreadyProcessed: false, event, session };
  },

  /**
   * Obtener sesiones de pago de una organización
   */
  async getPaymentHistory(organizationId) {
    return PaymentSession.find({ organizationId })
      .populate("planId")
      .sort({ createdAt: -1 });
  },
};

export default paymentService;
