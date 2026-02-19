import mongoose from "mongoose";

const exchangeCodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true,
  },
  role: {
    type: String,
    required: true,
  },

  // ─── Campos de impersonación (opcionales, null en flujo normal) ───
  // Si impersonatedBy está presente, este code fue generado por un superadmin.
  impersonatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "AdminUser",
    default: null,
  },
  impersonationReason: {
    type: String,
    default: null,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 }, // TTL index: MongoDB auto-deletes when expiresAt is reached
  },
});

export default mongoose.model("ExchangeCode", exchangeCodeSchema);
