import mongoose from "mongoose";

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
    start: {
      type: String,
      required: true,
    },
    end: {
      type: String,
      required: true,
    },
  },
  plan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Plan",
    required: false,
  },
  clientIdWhatsapp: {
    type: String,
    required: false,
  },
  branding: {
    logoUrl: String,
    faviconUrl: String,
    primaryColor: String,
    secondaryColor: String, // Opcional
    themeColor: String,
    pwaName: String,
    pwaIcon: String,
    pwaShortName: String,
    pwaDescription: String,
    footerTextColor: String,
    manifest: Object,
  },
  domain: String, // Ej: "agenda.zybizobazar.com" o "salonmaria.com"
  plan: {
    type: String,
    enum: ["basic", "professional", "premium"],
    default: "basic",
  },
});

export default mongoose.model("Organization", organizationSchema);
