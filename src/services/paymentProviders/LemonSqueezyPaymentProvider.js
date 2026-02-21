// services/paymentProviders/LemonSqueezyPaymentProvider.js
import crypto from "crypto";
import PaymentProvider from "./PaymentProvider.js";

const LS_API_URL = "https://api.lemonsqueezy.com/v1";

export default class LemonSqueezyPaymentProvider extends PaymentProvider {
  constructor() {
    super("lemonsqueezy");
    this.apiKey = process.env.LEMON_SQUEEZY_API_KEY;
    this.storeId = process.env.LEMON_SQUEEZY_STORE_ID;
    this.webhookSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  }

  /**
   * Crea un checkout en Lemon Squeezy para un pago único.
   * Genera el sessionId internamente y lo embebe en custom_data para
   * vincularlo cuando llegue el webhook order_created.
   *
   * @param {object} params
   * @param {string} params.variantId   - Lemon Squeezy variant ID del plan
   * @param {string} params.organizationId
   * @param {string} params.planId
   * @param {string} [params.successUrl]
   * @returns {{ sessionId, checkoutUrl, rawResponse }}
   */
  async createCheckout({ variantId, organizationId, planId, successUrl }) {
    // Generar nuestro UUID interno (igual que ManualPaymentProvider)
    const sessionId = `ls_${crypto.randomUUID()}`;
    if (!variantId) {
      throw new Error("Este plan no tiene un variantId de Lemon Squeezy configurado");
    }

    const redirectUrl =
      successUrl ||
      `${process.env.FRONTEND_BASE_URL}/payment-success`;

    const response = await fetch(`${LS_API_URL}/checkouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
      },
      body: JSON.stringify({
        data: {
          type: "checkouts",
          attributes: {
            checkout_data: {
              custom: {
                session_id: sessionId,
                organization_id: String(organizationId),
                plan_id: String(planId),
              },
            },
            product_options: {
              redirect_url: redirectUrl,
            },
          },
          relationships: {
            store: {
              data: { type: "stores", id: String(this.storeId) },
            },
            variant: {
              data: { type: "variants", id: String(variantId) },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(
        `Lemon Squeezy API error ${response.status}: ${JSON.stringify(errorBody)}`
      );
    }

    const data = await response.json();
    const checkout = data.data;

    return {
      sessionId, // conservamos nuestro UUID interno
      checkoutUrl: checkout.attributes.url,
      rawResponse: checkout,
    };
  }

  /**
   * Valida la firma del webhook (HMAC-SHA256) y parsea el evento.
   * Requiere req.rawBody (string) para la validación.
   *
   * @param {object} headers  - req.headers
   * @param {object} body     - req.body (ya parseado)
   * @param {string} rawBody  - req.rawBody (string crudo, para HMAC)
   * @returns {{ eventId, type, sessionId, amount, currency, status, raw }}
   */
  parseWebhook(headers, body, rawBody) {
    // 1. Validar firma
    const signature = headers["x-signature"];
    if (!signature) {
      throw new Error("Falta el header X-Signature en el webhook");
    }
    if (!rawBody) {
      throw new Error("rawBody no disponible para validar la firma");
    }

    const computed = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(rawBody)
      .digest("hex");

    if (computed !== signature) {
      throw new Error("Firma de webhook inválida");
    }

    // 2. Extraer datos del evento
    const eventName = body.meta?.event_name;
    if (!eventName) {
      throw new Error("Evento de webhook sin event_name");
    }

    // Solo procesamos order_created por ahora (pago único exitoso)
    const customData = body.meta?.custom_data || {};
    const sessionId = customData.session_id;
    if (!sessionId) {
      throw new Error("El webhook no contiene session_id en custom_data");
    }

    const orderId = body.data?.id;
    const eventId = `${eventName}_${orderId}`;

    const attributes = body.data?.attributes || {};

    // LS reporta montos en centavos (USD) o en la moneda original
    const amountRaw = attributes.total_usd ?? attributes.total ?? 0;
    const amount = amountRaw / 100;
    const currency = (attributes.currency || "USD").toUpperCase();

    // order_created con status 'paid' → succeeded; cualquier otro → failed
    let status = "failed";
    if (eventName === "order_created" && attributes.status === "paid") {
      status = "succeeded";
    }

    return {
      eventId,
      type: eventName,
      sessionId,
      amount,
      currency,
      status,
      raw: body,
    };
  }

  /**
   * verifySession no aplica para el flujo webhook-first.
   * El webhook es la fuente de verdad; esta función queda como no-op.
   */
  async verifySession(_sessionId) {
    return null;
  }
}
