import mongoose from "mongoose";

// Schema para intervalos de descanso (breaks) dentro de un día
const OpeningBreakSchema = new mongoose.Schema(
  {
    start: { type: String, required: true }, // "12:00"
    end: { type: String, required: true }, // "13:00"
    note: { type: String },
  },
  { _id: false }
);

// Schema para horario de un día específico
const DayScheduleSchema = new mongoose.Schema(
  {
    day: { 
      type: Number, 
      min: 0, 
      max: 6, 
      required: true 
    }, // 0=Domingo, 1=Lunes, ..., 6=Sábado
    isOpen: { 
      type: Boolean, 
      default: true 
    }, // Si está abierto ese día
    start: { 
      type: String, 
      required: function() { return this.isOpen; }
    }, // "08:00"
    end: { 
      type: String, 
      required: function() { return this.isOpen; }
    }, // "20:00"
    breaks: {
      type: [OpeningBreakSchema],
      default: [],
    },
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

const PaymentMethodSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["nequi", "bancolombia", "daviplata", "otros"],
      required: true,
    },
    accountName: { type: String },
    accountNumber: { type: String },
    phoneNumber: { type: String },
    qrCodeUrl: { type: String },
    notes: { type: String },
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
  // 🌍 País por defecto para nuevos registros
  default_country: {
    type: String,
    required: false,
    default: 'CO', // Colombia por defecto
    maxlength: 2,
  },
  // 🕐 Zona horaria de la organización (IANA timezone)
  timezone: {
    type: String,
    required: false,
    default: 'America/Bogota',
    // Ejemplos: 'America/Mexico_City', 'America/New_York', 'Europe/Madrid'
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
  // DEPRECATED: Mantener para compatibilidad
  openingHours: {
    start: { type: String },
    end: { type: String },
    businessDays: {
      type: [Number], // 0..6
      default: [1, 2, 3, 4, 5], // L-V
    },
    breaks: {
      type: [OpeningBreakSchema],
      default: [],
    },
    stepMinutes: { type: Number, default: 5, min: 1, max: 60 },
  },

  // NUEVO: Sistema de horarios por día de la semana
  weeklySchedule: {
    enabled: { type: Boolean, default: false }, // Si está habilitado el horario semanal
    schedule: {
      type: [DayScheduleSchema],
      default: function() {
        // Horario por defecto: Lunes a Viernes 8AM-8PM, Sábado 8AM-2PM, Domingo cerrado
        return [
          { day: 0, isOpen: false }, // Domingo
          { day: 1, isOpen: true, start: "08:00", end: "20:00", breaks: [] }, // Lunes
          { day: 2, isOpen: true, start: "08:00", end: "20:00", breaks: [] }, // Martes
          { day: 3, isOpen: true, start: "08:00", end: "20:00", breaks: [] }, // Miércoles
          { day: 4, isOpen: true, start: "08:00", end: "20:00", breaks: [] }, // Jueves
          { day: 5, isOpen: true, start: "08:00", end: "20:00", breaks: [] }, // Viernes
          { day: 6, isOpen: true, start: "08:00", end: "14:00", breaks: [] }, // Sábado
        ];
      },
    },
    stepMinutes: { type: Number, default: 30, min: 5, max: 60 }, // Intervalo de tiempo para slots
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

  // Sistema de membresías
  currentMembershipId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Membership",
    default: null,
  },
  membershipStatus: {
    type: String,
    enum: ["active", "trial", "suspended", "none"],
    default: "trial",
  },
  hasAccessBlocked: {
    type: Boolean,
    default: false,
  },

  // DEPRECATED: Mantener temporalmente para migración
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
  paymentMethods: {
    type: [PaymentMethodSchema],
    default: [],
  },
  requireReservationDeposit: {
    type: Boolean,
    default: false,
  },
  reservationDepositPercentage: {
    type: Number,
    default: 50,
    min: 0,
    max: 100,
  },
  welcomeTitle: {
    type: String,
    default: "¡Hola! Bienvenido",
  },
  welcomeDescription: {
    type: String,
    default:
      "Estamos felices de tenerte aquí. Mereces lo mejor, ¡y aquí lo encontrarás! ✨",
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
