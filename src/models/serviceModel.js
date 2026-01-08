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
  // 👥 Número de clientes que pueden ser atendidos simultáneamente por un empleado
  // (ej: doctor puede ver 2 pacientes a la vez)
  maxConcurrentAppointments: { type: Number, default: 1, min: 1 },
});

export default model("Service", serviceSchema);
