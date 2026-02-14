// services/paymentService.js
import PaymentSession from "../models/paymentSessionModel.js";
import PaymentEvent from "../models/paymentEventModel.js";
import membershipService from "./membershipService.js";
import ManualPaymentProvider from "./paymentProviders/ManualPaymentProvider.js";

// Registry de providers
const providers = {
  manual: new ManualPaymentProvider(),
  // stripe: new StripePaymentProvider(),  ← futuro
  // polar: new PolarPaymentProvider(),    ← futuro
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
  async createCheckoutSession({ provider: providerName, organizationId, planId, membershipId, amount, currency, successUrl, cancelUrl }) {
    const provider = this.getProvider(providerName);

    const result = await provider.createCheckout({
      organizationId, planId, amount, currency, successUrl, cancelUrl,
    });

    const session = await PaymentSession.create({
      provider: providerName,
      sessionId: result.sessionId,
      checkoutUrl: result.checkoutUrl,
      organizationId,
      planId,
      membershipId,
      amount,
      currency: currency || "COP",
      status: "created",
      rawCreateResponse: result.rawResponse,
    });

    return session;
  },

  /**
   * Procesar webhook/confirmación (IDEMPOTENTE).
   * Usa activatePaidPlan() para activar la membresía.
   */
  async processPaymentEvent({ provider: providerName, eventId, type, sessionId, amount, currency, status, raw }) {
    // 1. Idempotencia: verificar si ya procesamos este evento (provider + eventId)
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

    // 3. Registrar el evento
    const event = await PaymentEvent.create({
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

    // 4. Si el pago fue exitoso, activar la membresía con activatePaidPlan
    if (status === "succeeded") {
      session.status = "succeeded";
      session.processed = true;
      session.processedAt = new Date();
      session.processedEventIds.push(eventId);
      await session.save();

      // Activar membresía usando la función centralizada
      await membershipService.activatePaidPlan({
        organizationId: session.organizationId,
        planId: session.planId,
        paymentAmount: amount || session.amount,
      });
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
