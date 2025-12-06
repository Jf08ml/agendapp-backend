import { Schema, Types, model } from "mongoose";

const serviceSchema = new Schema({
  images: [{ type: String }],
  name: { type: String, required: true },
  type: { type: String, required: false },
  icon: { type: String },
  description: { type: String },
  price: { type: Number, required: true },
  duration: { type: Number, required: true },
  organizationId: { type: Types.ObjectId, ref: "Organization", required: true },
  isActive: { type: Boolean, default: true },
  hidePrice: { type: Boolean, default: false },
});

export default model("Service", serviceSchema);
