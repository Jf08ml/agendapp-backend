// services/paymentProviders/ManualPaymentProvider.js
import crypto from "crypto";
import PaymentProvider from "./PaymentProvider.js";

export default class ManualPaymentProvider extends PaymentProvider {
  constructor() {
    super("manual");
  }

  async createCheckout({ organizationId, planId, amount, currency }) {
    const sessionId = `manual_${crypto.randomUUID()}`;
    return {
      sessionId,
      checkoutUrl: null, // No hay URL externa para pago manual
      rawResponse: { provider: "manual", organizationId, planId, amount, currency },
    };
  }

  /**
   * Para pagos manuales, el "webhook" es la confirmación del superadmin.
   * El eventId es DETERMINÍSTICO basado en manualPaymentId (lo envía el admin).
   * Esto garantiza idempotencia: confirmar dos veces el mismo pago no duplica.
   */
  parseWebhook(headers, body) {
    const { manualPaymentId, sessionId, amount, currency, adminNotes } = body;

    if (!manualPaymentId) {
      throw new Error("manualPaymentId es requerido para pagos manuales");
    }

    return {
      eventId: `manual_${manualPaymentId}`,
      type: "manual_payment.confirmed",
      sessionId,
      amount,
      currency: currency || "COP",
      status: "succeeded",
      raw: body,
    };
  }
}
