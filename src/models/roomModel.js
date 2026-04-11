import { Schema, Types, model } from "mongoose";

const roomSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true },
    name: { type: String, required: true },
    // Cupo físico máximo del salón
    capacity: { type: Number, required: true, min: 1 },
    description: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

roomSchema.index({ organizationId: 1 });

export default model("Room", roomSchema);
