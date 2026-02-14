import mongoose from "mongoose";

const paymentEventSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    eventId: { type: String, required: true, index: true },
    type: { type: String, index: true },
    sessionId: { type: String, index: true },

    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization" },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: "Plan" },
    membershipId: { type: mongoose.Schema.Types.ObjectId, ref: "Membership" },

    currency: { type: String },
    amount: { type: Number },
    status: { type: String },

    headers: { type: Object },
    raw: { type: Object },
  },
  { timestamps: true }
);

// Idempotencia: un eventId por provider (distintos providers pueden coincidir IDs)
paymentEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

const PaymentEvent = mongoose.models.PaymentEvent || mongoose.model("PaymentEvent", paymentEventSchema);
export default PaymentEvent;
