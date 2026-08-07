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
    // 🙈 Oculta el precio en la vista pública (landing, catálogo, detalle,
    // reserva) — igual semántica que Service.hidePrice.
    hidePrice: { type: Boolean, default: false },
    groupDiscount: { type: groupDiscountSchema, default: () => ({}) },
    // Color para identificación visual en la agenda
    color: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    // 🌐 Visibilidad pública: si es false, la clase sigue disponible para
    // programar sesiones desde el panel (isActive la gobierna), pero no
    // aparece en la landing pública ni en el catálogo/reserva de clases.
    isPublic: { type: Boolean, default: true },
    // 🖼️ Imágenes representativas mostradas en el catálogo/detalle público
    images: [{ type: String }],
    // ⭐ Programa destacado: se muestra primero en catálogo y landing
    featured: { type: Boolean, default: false },
    // 📄 Material adicional mostrado en el detalle público del programa
    pdfUrl: { type: String, default: null },
    videoUrl: { type: String, default: null },
  },
  { timestamps: true }
);

classSchema.index({ organizationId: 1 });

export default model("Class", classSchema);
