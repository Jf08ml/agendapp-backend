import mongoose from "mongoose";

const agentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: null },
    type: {
      type: String,
      required: true,
      enum: ["influencer", "vendedor_externo", "vendedor_interno", "medio_comunicacion"],
    },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

agentSchema.index({ code: 1 });
agentSchema.index({ status: 1 });

const Agent = mongoose.model("Agent", agentSchema);

export default Agent;
