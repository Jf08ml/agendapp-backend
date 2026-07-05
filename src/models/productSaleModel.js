import mongoose from "mongoose";

const saleItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  // Snapshots: el producto puede cambiar de nombre/precio después de la venta
  name: { type: String, required: true },
  quantity: { type: Number, min: 1, required: true },
  unitPrice: { type: Number, min: 0, required: true },
  costPrice: { type: Number, min: 0, default: 0 },
});

const productSaleSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    items: {
      type: [saleItemSchema],
      required: true,
    },
    total: {
      type: Number,
      min: 0,
      required: true,
    },
    method: {
      type: String,
      enum: ["cash", "card", "transfer", "other"],
      default: "cash",
    },
    // Profesional que vendió (comisiona)
    soldBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    // Snapshot calculado al vender (no recalcular en reportes)
    commissionAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      default: null,
    },
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      default: null,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    note: {
      type: String,
      default: "",
    },
    registeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
  },
  { timestamps: true }
);

productSaleSchema.index({ organizationId: 1, date: -1 });

export default mongoose.model("ProductSale", productSaleSchema);
