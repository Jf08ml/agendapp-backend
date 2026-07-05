import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      default: "",
      trim: true,
    },
    brand: {
      type: String,
      default: "",
      trim: true,
    },
    sku: {
      type: String,
      default: "",
      trim: true,
    },
    barcode: {
      type: String,
      default: "",
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    // Imagen del producto (URL de ImageKit); "" = sin imagen
    imageUrl: {
      type: String,
      default: "",
      trim: true,
    },
    costPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    salePrice: {
      type: Number,
      min: 0,
      required: true,
    },
    trackStock: {
      type: Boolean,
      default: true,
    },
    stockQuantity: {
      type: Number,
      min: 0,
      default: 0,
    },
    lowStockThreshold: {
      type: Number,
      min: 0,
      default: 0, // 0 = sin alerta
    },
    lowStockNotifiedAt: {
      type: Date,
      default: null, // anti-spam de alertas de stock bajo
    },
    // Comisión propia del producto (override); si es null se usa la del empleado
    commissionType: {
      type: String,
      enum: ["percentage", "fixed", null],
      default: null,
    },
    commissionValue: {
      type: Number,
      min: 0,
      default: 0,
    },
    // 🛍️ Opt-in a la tienda pública: solo se listan/venden en /tienda los
    // productos activos con este flag (evita exponer productos internos).
    visibleInStore: {
      type: Boolean,
      default: false,
    },
    active: {
      type: Boolean,
      default: true, // soft-delete: las ventas referencian el id
    },
  },
  { timestamps: true }
);

productSchema.index({ organizationId: 1, active: 1 });

export default mongoose.model("Product", productSchema);
