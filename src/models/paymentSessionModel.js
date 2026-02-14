import mongoose from "mongoose";

const paymentSessionSchema = new mongoose.Schema(
  {
    provider: { type: String },
    sessionId: { type: String, required: true, index: true, unique: true },
    checkoutUrl: { type: String },

    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", required: true },
    membershipId: { type: mongoose.Schema.Types.ObjectId, ref: "Membership" },

    currency: { type: String, default: "USD" },
    amount: { type: Number },
    status: { type: String, default: "created" }, // created | succeeded | failed
    processed: { type: Boolean, default: false },
    processedAt: { type: Date },
    processedEventIds: [{ type: String }], // IDs de eventos ya procesados para evitar duplicados
    rawCreateResponse: { type: Object },
    rawWebhookEvent: { type: Object },
  },
  { timestamps: true }
);

const PaymentSession = mongoose.models.PaymentSession || mongoose.model("PaymentSession", paymentSessionSchema);
export default PaymentSession;
