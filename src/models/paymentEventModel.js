import mongoose from "mongoose";

const paymentEventSchema = new mongoose.Schema(
  {
    provider: { type: String, default: "polar" },
    eventId: { type: String, required: true, index: true, unique: true },
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

const PaymentEvent = mongoose.models.PaymentEvent || mongoose.model("PaymentEvent", paymentEventSchema);
export default PaymentEvent;
