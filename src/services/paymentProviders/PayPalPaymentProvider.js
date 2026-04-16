// services/paymentProviders/PayPalPaymentProvider.js
//
// Enfoque: PayPal JS SDK (botones en página, sin redirección).
// El frontend renderiza los botones; este provider solo verifica pagos y maneja webhooks.
//
// SessionId convention:
//   sub_{subscriptionId}  →  suscripción mensual automática
//   pp_{orderId}          →  pago único

import PaymentProvider from "./PaymentProvider.js";

const PAYPAL_BASE = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

export default class PayPalPaymentProvider extends PaymentProvider {
  constructor() {
    super("paypal");
    this.clientId = process.env.PAYPAL_CLIENT_ID;
    this.clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    this.webhookId = process.env.PAYPAL_WEBHOOK_ID;
    this.mode = process.env.PAYPAL_MODE || "sandbox";
    this.baseUrl = PAYPAL_BASE[this.mode] || PAYPAL_BASE.sandbox;
    this._token = null;
    this._tokenExpiry = 0;
  }

  // ─── OAuth2 ────────────────────────────────────────────────────────────────

  async _getToken() {
    if (this._token && Date.now() < this._tokenExpiry - 300_000) {
      return this._token;
    }
    const creds = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`PayPal OAuth error ${res.status}: ${JSON.stringify(err)}`);
    }
    const data = await res.json();
    this._token = data.access_token;
    this._tokenExpiry = Date.now() + data.expires_in * 1000;
    return this._token;
  }

  // ─── Verificación de suscripción ──────────────────────────────────────────

  /**
   * Verifica que una suscripción existe y está activa en PayPal.
   * Llamado desde el endpoint /paypal/subscription-created después de que el
   * usuario aprueba en el popup del SDK.
   *
   * @param {string} subscriptionId  - data.subscriptionID del onApprove del SDK
   * @returns {{ subscriptionId, status, planId, amount, currency }}
   */
  async verifySubscription(subscriptionId) {
    const token = await this._getToken();
    const res = await fetch(`${this.baseUrl}/v1/billing/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`PayPal get subscription error ${res.status}: ${JSON.stringify(err)}`);
    }
    const sub = await res.json();
    // Estados válidos post-aprobación: ACTIVE, APPROVED
    const validStatuses = ["ACTIVE", "APPROVED"];
    if (!validStatuses.includes(sub.status)) {
      throw new Error(`Suscripción PayPal en estado inesperado: ${sub.status}`);
    }
    const amount = parseFloat(sub.billing_info?.last_payment?.amount?.value || sub.plan?.billing_cycles?.[0]?.pricing_scheme?.fixed_price?.value || "0");
    const currency = (sub.billing_info?.last_payment?.amount?.currency_code || sub.plan?.billing_cycles?.[0]?.pricing_scheme?.fixed_price?.currency_code || "USD").toUpperCase();

    return {
      subscriptionId,
      paypalPlanId: sub.plan_id,
      status: sub.status,
      amount,
      currency,
      raw: sub,
    };
  }

  // ─── Captura y verificación de pago único ────────────────────────────────

  /**
   * Captura una orden aprobada en PayPal (si no está ya capturada) y la verifica.
   * El capture se hace en el backend para evitar fallos del SDK cliente.
   *
   * @param {string} orderId  - data.orderID del onApprove del SDK
   * @returns {{ eventId, type, sessionId, amount, currency, status, raw }}
   */
  async verifyOrderCapture(orderId) {
    const token = await this._getToken();

    // Obtener estado actual de la orden
    const getRes = await fetch(`${this.baseUrl}/v2/checkout/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!getRes.ok) {
      const err = await getRes.json().catch(() => ({}));
      throw new Error(`PayPal get order error ${getRes.status}: ${JSON.stringify(err)}`);
    }
    let order = await getRes.json();

    // Si está APPROVED (no capturada aún), capturar en el backend
    if (order.status === "APPROVED") {
      const captureRes = await fetch(`${this.baseUrl}/v2/checkout/orders/${orderId}/capture`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!captureRes.ok) {
        const err = await captureRes.json().catch(() => ({}));
        throw new Error(`PayPal capture error ${captureRes.status}: ${JSON.stringify(err)}`);
      }
      order = await captureRes.json();
    }

    if (order.status !== "COMPLETED") {
      throw new Error(`Orden PayPal no completada: ${order.status}`);
    }

    const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
    const eventId = `capture_${capture?.id || orderId}`;
    const amount = parseFloat(capture?.amount?.value || "0");
    const currency = (capture?.amount?.currency_code || "USD").toUpperCase();

    return {
      eventId,
      type: "PAYMENT.CAPTURE.COMPLETED",
      sessionId: `pp_${orderId}`,
      amount,
      currency,
      status: "succeeded",
      raw: order,
    };
  }

  // ─── Webhooks ──────────────────────────────────────────────────────────────

  /**
   * Valida la firma del webhook via la API de PayPal y parsea el evento.
   * Async porque la verificación requiere una llamada a la API.
   *
   * Eventos procesados:
   *   BILLING.SUBSCRIPTION.ACTIVATED  → activar membresía (sub_{subscriptionId})
   *   PAYMENT.SALE.COMPLETED          → renovar membresía mensual (sub_{billing_agreement_id})
   *   BILLING.SUBSCRIPTION.CANCELLED  → registrar cancelación (membresía expira natural)
   *   BILLING.SUBSCRIPTION.SUSPENDED  → suspender membresía
   *   PAYMENT.CAPTURE.COMPLETED       → activar membresía pago único (pp_{orderId})
   *
   * @returns {{ eventId, type, sessionId, amount, currency, status, raw }}
   */
  async parseWebhook(headers, body, _rawBody) {
    // 1. Verificar firma
    // Omitir si PAYPAL_SKIP_WEBHOOK_VERIFY=true (desarrollo sin ngrok estable, o "Send Test" del dashboard).
    const skipVerify = process.env.PAYPAL_SKIP_WEBHOOK_VERIFY === "true";
    if (skipVerify) {
      console.warn("[PayPal] ⚠️  Verificación de firma deshabilitada (PAYPAL_SKIP_WEBHOOK_VERIFY=true)");
    } else {
      const token = await this._getToken();
      const verifyRes = await fetch(`${this.baseUrl}/v1/notifications/verify-webhook-signature`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          auth_algo: headers["paypal-auth-algo"],
          cert_url: headers["paypal-cert-url"],
          transmission_id: headers["paypal-transmission-id"],
          transmission_sig: headers["paypal-transmission-sig"],
          transmission_time: headers["paypal-transmission-time"],
          webhook_id: this.webhookId,
          webhook_event: body,
        }),
      });

      if (!verifyRes.ok) {
        throw new Error(`PayPal webhook verification API error: ${verifyRes.status}`);
      }
      const { verification_status } = await verifyRes.json();
      if (verification_status !== "SUCCESS") {
        throw new Error(`Firma de webhook PayPal inválida: ${verification_status}`);
      }
    }

    // 2. Parsear según tipo de evento
    const eventType = body.event_type;
    const resource = body.resource || {};

    switch (eventType) {
      // ── Suscripción activada (primer pago aprobado) ──────────────────────
      case "BILLING.SUBSCRIPTION.ACTIVATED": {
        const subscriptionId = resource.id;
        if (!subscriptionId) throw new Error("BILLING.SUBSCRIPTION.ACTIVATED sin resource.id");
        const amount = parseFloat(resource.billing_info?.last_payment?.amount?.value || "0");
        const currency = (resource.billing_info?.last_payment?.amount?.currency_code || "USD").toUpperCase();
        return {
          eventId: `sub_activated_${subscriptionId}`,
          type: eventType,
          sessionId: `sub_${subscriptionId}`,
          amount,
          currency,
          status: "succeeded",
          subscriptionId,
          raw: body,
        };
      }

      // ── Pago mensual recurrente ──────────────────────────────────────────
      case "PAYMENT.SALE.COMPLETED": {
        // billing_agreement_id = subscriptionId
        const subscriptionId = resource.billing_agreement_id;
        if (!subscriptionId) {
          // Podría ser un pago único antiguo sin suscripción, ignorar
          return {
            eventId: `ignored_${body.id || Date.now()}`,
            type: eventType,
            sessionId: null,
            amount: 0,
            currency: "USD",
            status: "ignored",
            raw: body,
          };
        }
        const saleId = resource.id;
        const amount = parseFloat(resource.amount?.total || "0");
        const currency = (resource.amount?.currency || "USD").toUpperCase();
        return {
          eventId: `sale_${saleId}`,
          type: eventType,
          sessionId: `sub_${subscriptionId}`,
          amount,
          currency,
          status: "succeeded",
          subscriptionId,
          raw: body,
        };
      }

      // ── Suscripción cancelada (membresía expira natural al vencer período) ──
      case "BILLING.SUBSCRIPTION.CANCELLED": {
        const subscriptionId = resource.id;
        return {
          eventId: `sub_cancelled_${subscriptionId}`,
          type: eventType,
          sessionId: `sub_${subscriptionId}`,
          amount: 0,
          currency: "USD",
          status: "cancelled",
          subscriptionId,
          raw: body,
        };
      }

      // ── Suscripción suspendida (pago recurrente fallido) ─────────────────
      case "BILLING.SUBSCRIPTION.SUSPENDED": {
        const subscriptionId = resource.id;
        return {
          eventId: `sub_suspended_${subscriptionId}`,
          type: eventType,
          sessionId: `sub_${subscriptionId}`,
          amount: 0,
          currency: "USD",
          status: "suspended",
          subscriptionId,
          raw: body,
        };
      }

      // ── Pago único capturado (safety net — también procesado por orderCaptured) ──
      case "PAYMENT.CAPTURE.COMPLETED": {
        const orderId = resource.supplementary_data?.related_ids?.order_id;
        if (!orderId) throw new Error("PAYMENT.CAPTURE.COMPLETED sin order_id en supplementary_data");
        const captureId = resource.id;
        const amount = parseFloat(resource.amount?.value || "0");
        const currency = (resource.amount?.currency_code || "USD").toUpperCase();
        return {
          eventId: `capture_${captureId}`,
          type: eventType,
          sessionId: `pp_${orderId}`,
          amount,
          currency,
          status: resource.status === "COMPLETED" ? "succeeded" : "failed",
          raw: body,
        };
      }

      // ── Eventos ignorados ────────────────────────────────────────────────
      default:
        return {
          eventId: `ignored_${body.id || Date.now()}`,
          type: eventType,
          sessionId: null,
          amount: 0,
          currency: "USD",
          status: "ignored",
          raw: body,
        };
    }
  }

  async verifySession(_sessionId) {
    return null;
  }
}
