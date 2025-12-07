import mongoose from "mongoose";

const OpeningBreakSchema = new mongoose.Schema(
  {
    day: { type: Number, min: 0, max: 6, required: true }, // 0=Dom .. 6=Sáb
    start: { type: String, required: true }, // "12:00"
    end: { type: String, required: true }, // "13:00"
    note: { type: String },
  },
  { _id: false }
);

const BrandingSchema = new mongoose.Schema(
  {
    logoUrl: String,
    faviconUrl: String,
    primaryColor: String,
    secondaryColor: String,
    themeColor: String,
    pwaName: String,
    pwaIcon: String,
    pwaShortName: String,
    pwaDescription: String,
    footerTextColor: String,
    manifest: Object,
  },
  { _id: false }
);

const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  iconUrl: {
    type: String,
    required: false,
  },
  email: {
    type: String,
    required: true,
  },
  location: {
    type: Object,
    required: true,
  },
  address: {
    type: String,
    required: false,
  },
  password: {
    type: String,
    required: true,
  },
  phoneNumber: {
    type: String,
    required: true,
  },
  instagramUrl: {
    type: String,
    required: false,
  },
  facebookUrl: {
    type: String,
    required: false,
  },
  whatsappUrl: {
    type: String,
    required: false,
  },
  tiktokUrl: {
    type: String,
    required: false,
  },
  role: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Role",
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  referredCount: {
    type: Number,
    default: 0,
  },
  referredReward: {
    type: String,
    required: false,
  },
  serviceCount: {
    type: Number,
    default: 0,
  },
  serviceReward: {
    type: String,
    required: false,
  },
  openingHours: {
    start: { type: String, required: true },
    end: { type: String, required: true },

    // NUEVO:
    businessDays: {
      type: [Number], // 0..6
      default: [1, 2, 3, 4, 5], // L-V
    },
    breaks: {
      type: [OpeningBreakSchema],
      default: [],
    },
  },
  // plan: {
  //   type: mongoose.Schema.Types.ObjectId,
  //   ref: "Plan",
  //   required: false,
  // },
  clientIdWhatsapp: {
    type: String,
    required: false,
  },
  branding: {
    type: BrandingSchema,
    default: {},
  },
  domains: {
    type: [String],
    required: true,
    default: [],
  }, // Ej: "agenda.zybizobazar.com" o "salonmaria.com"
  plan: {
    type: String,
    enum: ["basic", "professional", "premium"],
    default: "basic",
  },
  reservationPolicy: {
    type: String,
    enum: ["manual", "auto_if_available"],
    default: "manual",
  },
  showLoyaltyProgram: {
    type: Boolean,
    default: true,
  },
  welcomeTitle: {
    type: String,
    default: "¡Hola! Bienvenido",
  },
  welcomeDescription: {
    type: String,
    default: "Estamos felices de tenerte aquí. Mereces lo mejor, ¡y aquí lo encontrarás! ✨",
  },
  homeLayout: {
    type: String,
    enum: ["modern", "minimal", "cards"],
    default: "modern",
  },
  reminderSettings: {
    enabled: {
      type: Boolean,
      default: true,
    },
    hoursBefore: {
      type: Number,
      default: 24,
      min: 1,
      max: 72, // Máximo 3 días antes
    },
    sendTimeStart: {
      type: String,
      default: "07:00", // Hora inicio para enviar (formato HH:mm)
    },
    sendTimeEnd: {
      type: String,
      default: "20:00", // Hora fin para enviar (formato HH:mm)
    },
  },
});

export default mongoose.model("Organization", organizationSchema);
