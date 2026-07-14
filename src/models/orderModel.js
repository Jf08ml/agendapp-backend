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
// 🛍️ Pedido de TIENDA pública (type "store"). Subdoc explícito (no metadata)
// para que la bandeja admin (/store-orders) sea consultable. Los items son
// snapshots (nombre/precio al momento de comprar); el stock se descuenta al
// confirmarse el pago (fulfillStoreOrder) o al cobrar contraentrega (collect).
// `default: undefined` en el Order: solo existe en pedidos de tienda.
const StoreOrderSchema = new mongoose.Schema(
  {
    items: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        name: { type: String },
        quantity: { type: Number },
        unitPrice: { type: Number },
      },
    ],
    // Snapshot del comprador (no se crea Client).
    customer: {
      name: { type: String },
      phone: { type: String },
      email: { type: String },
      documentId: { type: String },
    },
    delivery: {
      mode: { type: String, enum: ["pickup", "delivery"] },
      address: { type: String },
      notes: { type: String },
      // 📍 Punto exacto (opcional) capturado con el mini-mapa en el checkout
      lat: { type: Number },
      lng: { type: Number },
    },
    fulfillmentStatus: {
      type: String,
      enum: ["pending", "delivered", "cancelled"],
      default: "pending",
    },
    fulfilledAt: { type: Date },
    fulfilledBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    // ProductSale creada al confirmar el pago (fulfillment) o al cobrar COD.
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: "ProductSale" },
  },
  { _id: false }
);

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
      enum: ["reservation", "package", "class", "store"],
      default: "reservation",
    },
    // Referencia al objeto pagado. Para reservas = groupId del grupo de reservas.
    refId: { type: mongoose.Schema.Types.ObjectId, index: true },

    amount: { type: Number, required: true }, // monto del depósito a cobrar
    currency: { type: String, required: true }, // de Organization.currency
    marketplaceFee: { type: Number, default: 0 }, // comisión de plataforma (v1 = 0)

    // "mercadopago" (checkout automático) | "receipt" (transferencia manual +
    // comprobante validado con IA) | "cod" (contraentrega — solo type "store":
    // el pedido nace "pending" y el admin registra el cobro al entregar).
    // El cumplimiento (fulfillOrder) es el mismo para los pagos online.
    provider: { type: String, default: "mercadopago" },
    providerPrefId: { type: String }, // id de la preference de MP
    providerPaymentId: { type: String }, // id del payment (llega por webhook)

    // Identificador propio enviado a MP como external_reference; se usa para
    // hacer match en el webhook. Se setea = String(order._id) al crear.
    externalReference: { type: String, index: true, unique: true, sparse: true },

    status: {
      type: String,
      // in_review: comprobante recibido, esperando aprobación del admin (provider "receipt").
      enum: ["created", "pending", "in_review", "paid", "failed", "expired", "refunded"],
      default: "created",
    },

    // 🧾 Comprobante de pago (provider "receipt"). La imagen la sube el cliente
    // en la pantalla de pago; la IA extrae los datos y valida contra el Order.
    receipt: {
      imageUrl: { type: String },
      imageFileId: { type: String }, // fileId de ImageKit (para poder borrar)
      uploadedAt: { type: Date },
      // Datos extraídos por la IA del comprobante.
      extracted: {
        amount: { type: Number },
        currency: { type: String },
        date: { type: String }, // fecha/hora del comprobante (texto crudo)
        dateIso: { type: String }, // fecha normalizada YYYY-MM-DD (regla de antigüedad)
        reference: { type: String }, // n.º de transacción / referencia (anti-duplicado)
        destinationAccount: { type: String },
        bank: { type: String },
        senderName: { type: String },
      },
      aiConfidence: { type: Number }, // 0–1
      aiVerdict: { type: String, enum: ["match", "mismatch", "unreadable"] },
      aiNotes: { type: String }, // explicación corta de la IA
      // auto_approved: la IA confirmó sola | pending_review: requiere admin
      // approved/rejected: decisión manual del admin.
      reviewStatus: {
        type: String,
        enum: ["auto_approved", "pending_review", "approved", "rejected"],
      },
      reviewedBy: { type: String }, // id/nombre del admin que decidió
      reviewedAt: { type: Date },
      reviewNotes: { type: String }, // motivo del rechazo, opcional
    },

    // Nº de comprobantes subidos para esta orden (anti-abuso: cada subida llama
    // a la IA, que cuesta). Se topa en submitReceipt.
    receiptAttempts: { type: Number, default: 0 },

    // 🛍️ Datos del pedido de tienda (ver StoreOrderSchema). Solo en type "store".
    store: { type: StoreOrderSchema, default: undefined },

    checkoutUrl: { type: String },
    paidAt: { type: Date },
    expiresAt: { type: Date }, // TTL del hold del cupo

    // Idempotencia de webhooks (mismo patrón que PaymentSession).
    processedEventIds: [{ type: String }],

    // Datos necesarios para "cumplir" la orden al confirmarse el pago (webhook).
    // - package: { clientId, servicePackageId } → crea el ClientPackage.
    // - class:   { groupId } (también en refId) → confirma las inscripciones.
    metadata: { type: mongoose.Schema.Types.Mixed },

    raw: { type: mongoose.Schema.Types.Mixed }, // respuestas crudas de MP (debug)
  },
  { timestamps: true }
);

orderSchema.index({ organizationId: 1, status: 1 });
// Bandeja de pedidos de tienda (/store-orders?fulfillment=...).
orderSchema.index({ organizationId: 1, type: 1, "store.fulfillmentStatus": 1 });
// Anti-duplicado de comprobantes: misma org + misma referencia ya pagada.
orderSchema.index({ organizationId: 1, "receipt.extracted.reference": 1 });

const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);
export default Order;
