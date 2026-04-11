import { Schema, Types, model } from "mongoose";

const groupDiscountSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    // Mínimo de personas para aplicar el descuento
    minPeople: { type: Number, default: 2, min: 2 },
    // Máximo de personas para aplicar el descuento (null = sin límite superior)
    maxPeople: { type: Number, default: null },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
  },
  { _id: false }
);

const classSchema = new Schema(
  {
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    // Duración en minutos
    duration: { type: Number, required: true, min: 1 },
    // Cupo por defecto para las sesiones (puede sobreescribirse por sesión)
    defaultCapacity: { type: Number, required: true, min: 1 },
    pricePerPerson: { type: Number, required: true, min: 0 },
    groupDiscount: { type: groupDiscountSchema, default: () => ({}) },
    // Color para identificación visual en la agenda
    color: { type: String, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

classSchema.index({ organizationId: 1 });

export default model("Class", classSchema);
