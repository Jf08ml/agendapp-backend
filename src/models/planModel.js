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
    }, // "plan-esencial", "plan-marca-propia"
    displayName: {
      type: String,
      required: true,
    }, // "Plan Esencial (Subdominio)", "Plan Marca Propia (Dominio)"
    price: {
      type: Number,
      required: true,
      min: [0, "El precio no puede ser negativo"],
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
    // Configuración de dominio
    domainType: {
      type: String,
      enum: ["subdomain", "custom_domain"],
      required: true,
    }, // subdomain = subdominio, custom_domain = dominio propio
    
    // Límites y características (preparado para futuro)
    limits: {
      maxEmployees: { type: Number, default: null }, // null = ilimitado
      maxServices: { type: Number, default: null },
      maxAppointmentsPerMonth: { type: Number, default: null },
      maxStorageGB: { type: Number, default: null },
      customBranding: { type: Boolean, default: false },
      whatsappIntegration: { type: Boolean, default: true },
      analyticsAdvanced: { type: Boolean, default: false },
      prioritySupport: { type: Boolean, default: false },
    },
    
    isActive: {
      type: Boolean,
      default: true,
    },
    description: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Plan", planSchema);
