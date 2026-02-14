// services/paymentProviders/PaymentProvider.js

/**
 * Clase base abstracta para proveedores de pago.
 * Cada proveedor (manual, Stripe, Polar, etc.) debe extender esta clase.
 */
export default class PaymentProvider {
  constructor(name) {
    this.name = name;
  }

  /**
   * Crea un checkout/sesión de pago.
   * @returns {{ sessionId: string, checkoutUrl: string|null, rawResponse: object }}
   */
  async createCheckout({ organizationId, planId, amount, currency, successUrl, cancelUrl }) {
    throw new Error(`${this.name}: createCheckout not implemented`);
  }

  /**
   * Parsea un evento webhook del proveedor.
   * @returns {{ eventId: string, type: string, sessionId: string, amount: number, currency: string, status: string, raw: object }}
   */
  parseWebhook(headers, body) {
    throw new Error(`${this.name}: parseWebhook not implemented`);
  }

  /**
   * Verifica el estado de una sesión (server-side verification).
   * @returns {{ paid: boolean, amount: number, currency: string } | null}
   */
  async verifySession(sessionId) {
    return null;
  }
}
