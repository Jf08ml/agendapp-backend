import mongoose from "mongoose";

/**
 * Order — pago de un CLIENTE FINAL a una ORGANIZACIÓN (cobro cliente→org).
 *
 * Es DISTINTO de `PaymentSession`/`Subscription`, que modelan el pago de la
 * organización a AgenditApp (suscripciones vía PayPal). Aquí el dinero va
 * DIRECTO al comercio vía Mercado Pago (OAuth/marketplace); la plataforma no
 * toca fondos.
 *
 * Primer objeto pagable: el depósito de una reserva (pay-to-confirm). En el
 * futuro: paquetes y clases (de ahí el campo `type`).
 */
const orderSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },

    // Qué se está pagando. v1 solo "reservation".
    type: {
      type: String,
      enum: ["reservation", "package", "class"],
      default: "reservation",
    },
    // Referencia al objeto pagado. Para reservas = groupId del grupo de reservas.
    refId: { type: mongoose.Schema.Types.ObjectId, index: true },

    amount: { type: Number, required: true }, // monto del depósito a cobrar
    currency: { type: String, required: true }, // de Organization.currency
    marketplaceFee: { type: Number, default: 0 }, // comisión de plataforma (v1 = 0)

    provider: { type: String, default: "mercadopago" },
    providerPrefId: { type: String }, // id de la preference de MP
    providerPaymentId: { type: String }, // id del payment (llega por webhook)

    // Identificador propio enviado a MP como external_reference; se usa para
    // hacer match en el webhook. Se setea = String(order._id) al crear.
    externalReference: { type: String, index: true, unique: true, sparse: true },

    status: {
      type: String,
      enum: ["created", "pending", "paid", "failed", "expired", "refunded"],
      default: "created",
    },

    checkoutUrl: { type: String },
    paidAt: { type: Date },
    expiresAt: { type: Date }, // TTL del hold del cupo

    // Idempotencia de webhooks (mismo patrón que PaymentSession).
    processedEventIds: [{ type: String }],

    raw: { type: mongoose.Schema.Types.Mixed }, // respuestas crudas de MP (debug)
  },
  { timestamps: true }
);

orderSchema.index({ organizationId: 1, status: 1 });

const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);
export default Order;
