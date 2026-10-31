// services/paymentService.js
import PaymentSession from "../models/paymentSessionModel.js";
import { emitSubscriptionPaid } from "./oficinaEventsService.js";
import PaymentEvent from "../models/paymentEventModel.js";
import Membership from "../models/membershipModel.js";
import Organization from "../models/organizationModel.js";
import Plan from "../models/planModel.js";
import mongoose from "mongoose";
import membershipService from "./membershipService.js";
import ManualPaymentProvider from "./paymentProviders/ManualPaymentProvider.js";
import PayPalPaymentProvider from "./paymentProviders/PayPalPaymentProvider.js";

// Registry de providers
const providers = {
  manual: new ManualPaymentProvider(),
  paypal: new PayPalPaymentProvider(),
};

const paymentService = {
  getProvider(name) {
    const provider = providers[name];
    if (!provider) throw new Error(`Payment provider "${name}" not registered`);
    return provider;
  },

  /**
   * Registra una suscripción PayPal recién aprobada por el usuario.
   * Crea la PaymentSession con sessionId = sub_{subscriptionId}.
   * La activación real de la membresía ocurre cuando llega el webhook
   * BILLING.SUBSCRIPTION.ACTIVATED de PayPal.
   */
  /**
   * Registra la sesión de una suscripción PayPal resolviendo el plan por el
   * plan_id de PayPal (nunca por un planId que mande el cliente: evitaría que
   * alguien se suscriba al plan barato y active el caro).
   */
  async recordPaypalSubscription({ subscriptionId, organizationId, paypalPlanId, amount, currency }) {
    const plan = await Plan.findOne({ paypalPlanId });
    if (!plan) throw new Error(`Ningún plan tiene paypalPlanId=${paypalPlanId}`);
    return this.recordSubscription({ subscriptionId, organizationId, planId: plan._id, amount, currency });
  },

  async recordSubscription({ subscriptionId, organizationId, planId, amount, currency }) {
    const sessionId = `sub_${subscriptionId}`;

    // Evitar duplicados si el frontend llama dos veces
    const existing = await PaymentSession.findOne({ sessionId });
    if (existing) return existing;

    return PaymentSession.create({
      provider: "paypal",
      sessionId,
      organizationId,
      planId,
      amount: amount || 0,
      currency: currency || "USD",
      paymentMode: "subscription",
      status: "created",
    });
  },

  /**
   * Registra y activa un pago único de PayPal.
   * Crea la PaymentSession con sessionId = pp_{orderId} y procesa
   * el evento inmediatamente (la verificación la hizo el controller).
   */
  async recordOrderCapture({ orderId, organizationId, planId, amount, currency, eventId, raw }) {
    const sessionId = `pp_${orderId}`;

    // Crear session si no existe (puede que no exista si el usuario vino directo)
    let session = await PaymentSession.findOne({ sessionId });
    if (!session) {
      session = await PaymentSession.create({
        provider: "paypal",
        sessionId,
        organizationId,
        planId,
        amount: amount || 0,
        currency: currency || "USD",
        paymentMode: "once",
        status: "created",
      });
    }

    return this.processPaymentEvent({
      provider: "paypal",
      eventId,
      type: "PAYMENT.CAPTURE.COMPLETED",
      sessionId,
      amount,
      currency,
      status: "succeeded",
      paymentMode: "once",
      raw,
    });
  },

  /**
   * Procesar webhook/confirmación (IDEMPOTENTE).
   * Orden crítico: activar membresía ANTES de crear el PaymentEvent.
   * Si la activación falla, el PaymentEvent no se crea → el provider puede reintentar.
   */
  async processPaymentEvent({ provider: providerName, eventId, type, sessionId, amount, currency, status, subscriptionId, paymentMode, customId, paypalPlanId, raw }) {
    // 1. Idempotencia: si el PaymentEvent ya existe, fue procesado correctamente
    const existingEvent = await PaymentEvent.findOne({ provider: providerName, eventId });
    if (existingEvent) {
      console.log(`[Payment] Evento ${providerName}:${eventId} ya procesado, ignorando`);
      return { alreadyProcessed: true, event: existingEvent };
    }

    // 2. Buscar la sesión de pago
    let session = await PaymentSession.findOne({ sessionId });

    // Fallback para renovaciones de suscripción: si no hay sesión, buscar membresía por subscriptionId.
    // Esto cubre PAYMENT.SALE.COMPLETED de meses posteriores donde la sesión inicial ya no importa,
    // y también el caso sandbox donde múltiples webhooks llegan antes de que la sesión sea creada.
    let fallbackOrganizationId, fallbackPlanId, fallbackMembershipId;
    if (!session && subscriptionId) {
      const membership = await Membership.findOne({ paypalSubscriptionId: subscriptionId });
      if (membership) {
        console.log(`[Payment] Sesión ${sessionId} no encontrada, usando membresía por subscriptionId`);
        fallbackOrganizationId = membership.organizationId;
        fallbackPlanId = membership.planId;
        fallbackMembershipId = membership._id;
      }
    }

    // Suscripción nueva sin sesión (el aviso del frontend nunca llegó): la org viaja
    // en el custom_id de la suscripción y el plan se resuelve por el plan_id de PayPal.
    if (!session && !fallbackOrganizationId && subscriptionId && customId && paypalPlanId
        && mongoose.isValidObjectId(customId) && await Organization.exists({ _id: customId })) {
      console.log(`[Payment] Sesión ${sessionId} no encontrada, registrándola desde custom_id (org ${customId})`);
      session = await this.recordPaypalSubscription({ subscriptionId, organizationId: customId, paypalPlanId, amount, currency });
    }

    if (!session && !fallbackOrganizationId) {
      console.error(`[Payment] Sesión ${sessionId} no encontrada y no hay membresía con ese subscriptionId`);
      throw new Error(`Payment session ${sessionId} not found`);
    }

    const orgId = session?.organizationId ?? fallbackOrganizationId;
    const planId = session?.planId ?? fallbackPlanId;
    const resolvedPaymentMode = paymentMode || session?.paymentMode || "subscription";

    // 3. Activar o gestionar membresía según status
    if (status === "succeeded") {
      console.log(`[Payment] Activando membresía para org ${orgId}, plan ${planId} (mode: ${resolvedPaymentMode})`);
      await membershipService.activatePaidPlan({
        organizationId: orgId,
        planId,
        paymentAmount: amount || session?.amount || 0,
        subscriptionId: subscriptionId || null,
        paymentMode: resolvedPaymentMode,
      });
      console.log(`[Payment] Membresía activada para org ${orgId}`);
    } else if (status === "suspended") {
      const membership = await Membership.findOne({ organizationId: orgId });
      if (membership) {
        await membershipService.suspendMembership(membership._id, "Suscripción PayPal suspendida por falta de pago");
      }
    }
    // status === "cancelled" → no acción inmediata, la membresía expira naturalmente

    // 4. Registrar el evento como idempotency marker
    let event;
    try {
      event = await PaymentEvent.create({
        provider: providerName,
        eventId,
        type,
        sessionId,
        organizationId: orgId,
        planId,
        membershipId: session?.membershipId ?? fallbackMembershipId,
        amount: amount || session?.amount || 0,
        currency: currency || session?.currency || "USD",
        status,
        raw,
      });
    } catch (err) {
      if (err.code === 11000) {
        const ev = await PaymentEvent.findOne({ provider: providerName, eventId });
        return { alreadyProcessed: true, event: ev };
      }
      throw err;
    }

    // 4b. Conversión para AgenditApp Oficina IA: solo pagos confirmados y nuevos
    // (el PaymentEvent recién creado es la marca de idempotencia). Nunca lanza.
    if (status === "succeeded" && orgId) {
      const previousPaid = await PaymentEvent.countDocuments({
        organizationId: orgId,
        status: "succeeded",
        _id: { $ne: event._id },
      });
      await emitSubscriptionPaid({
        organizationId: orgId,
        provider: providerName,
        providerEventId: eventId,
        amount: event.amount,
        currency: event.currency,
        firstPayment: previousPaid === 0,
        occurredAt: event.createdAt,
      });
    }

    // 5. Actualizar estado de la sesión (solo si existe)
    if (session) {
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
