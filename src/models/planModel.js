import mongoose from "mongoose";

const planSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    displayName: {
      type: String,
      required: true,
    },
    
    // Precio y moneda unificados
    price: {
      type: Number,
      required: true,
      min: [0, "El precio no puede ser negativo"],
    },
    currency: {
      type: String,
      enum: ["USD", "COP", "MXN", "EUR", "CLP", "CRC", "ARS", "BRL", "PEN", "VES", "PAB", "CAD"],
      default: "USD",
      required: true,
    },
    
    billingCycle: {
      type: String,
      enum: ["monthly", "yearly", "lifetime"],
      default: "monthly",
    },
    
    characteristics: {
      type: [String],
      required: true,
      default: [],
    },
    
    description: {
      type: String,
      default: "",
    },
    
    // Configuración de dominio
    domainType: {
      type: String,
      enum: ["subdomain", "custom_domain"],
      required: true,
    },
    
    // Límites y características
    limits: {
      maxEmployees: { type: Number, default: null }, // null = ilimitado
      maxServices: { type: Number, default: null },
      maxAppointmentsPerMonth: { type: Number, default: null },
      maxStorageGB: { type: Number, default: 5 },
      customBranding: { type: Boolean, default: false },
      whatsappIntegration: { type: Boolean, default: true },
      analyticsAdvanced: { type: Boolean, default: false },
      prioritySupport: { type: Boolean, default: false },
      autoReminders: { type: Boolean, default: false },
      autoConfirmations: { type: Boolean, default: false },
      servicePackages: { type: Boolean, default: false },
    },
    
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Plan", planSchema);
