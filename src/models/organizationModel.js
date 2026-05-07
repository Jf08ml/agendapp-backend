import mongoose from "mongoose";

// Schema para configuración de campos del formulario de cliente
const ClientFieldConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // 'name'|'phone'|'email'|'birthDate'|'documentId'|'notes'
    enabled: { type: Boolean, default: true },
    required: { type: Boolean, default: false },
    label: { type: String }, // etiqueta personalizada, opcional
  },
  { _id: false }
);

// Schema para intervalos de descanso (breaks) dentro de un día
const OpeningBreakSchema = new mongoose.Schema(
  {
    day: { type: Number, min: 0, max: 6 }, // 0=Domingo, 1=Lunes, ..., 6=Sábado (opcional para compatibilidad)
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
    fontFamily: {
      type: String,
      enum: ["inter", "plus-jakarta-sans", "nunito", "dm-sans", "outfit", "manrope"],
      default: "inter",
    },
  },
  { _id: false }
);

const PaymentMethodSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["nequi", "bancolombia", "daviplata", "mercado_pago", "pix", "yape", "sinpe", "transferencia_bancaria", "efectivo", "otros"],
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
  ownerName: {
    type: String,
    required: false,
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
    default: 'UTC',
    // Ejemplos: 'America/Bogota', 'America/Mexico_City', 'Europe/Madrid'
  },
  // 💱 Moneda de la organización (ISO 4217)
  currency: {
    type: String,
    required: false,
    default: 'COP',
    maxlength: 3,
  },
  // 🕐 Formato de hora (12h con AM/PM o 24h)
  timeFormat: {
    type: String,
    enum: ['12h', '24h'],
    required: false,
    default: '12h',
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
  // Legacy — mantenidos para compatibilidad con datos anteriores
  referredCount: { type: Number, default: 0 },
  referredReward: { type: String, required: false },
  serviceCount: { type: Number, default: 0 },
  serviceReward: { type: String, required: false },

  // Sistema de niveles de fidelidad (reemplaza los campos legacy)
  serviceTiers: {
    type: [{ threshold: { type: Number, required: true }, reward: { type: String, required: true } }],
    default: [],
  },
  referralTiers: {
    type: [{ threshold: { type: Number, required: true }, reward: { type: String, required: true } }],
    default: [],
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
    stepMinutes: { type: Number, default: 30, min: 1, max: 1440 }, // Intervalo de tiempo para slots
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
  // Slug para subdominio wildcard: {slug}.agenditapp.com
  // Pre-migration: unique + sparse; Post-migration: unique + required (remove sparse)
  slug: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true,
  },
  domains: {
    type: [String],
    required: true,
    default: [],
  }, // Solo para dominios custom (NO guardar {slug}.agenditapp.com aquí)

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
    default: true, // Bloqueado por defecto hasta que compre un plan
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
  enableOnlineBooking: {
    type: Boolean,
    default: true,
  },
  enableClassBooking: {
    type: Boolean,
    default: false,
  },
  setupCompleted: {
    type: Boolean,
    default: false,
  },
  blockHolidaysForReservations: {
    type: Boolean,
    default: false,
  },
  allowedHolidayDates: {
    type: [String],
    default: [],
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
    enum: ["modern", "minimal", "cards", "landing"],
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
    secondReminder: {
      enabled: {
        type: Boolean,
        default: false,
      },
      hoursBefore: {
        type: Number,
        default: 2,
        min: 1,
        max: 72,
      },
    },
  },
  // 📋 Configuración del formulario de registro de cliente
  clientFormConfig: {
    identifierField: {
      type: String,
      enum: ['phone', 'email', 'documentId'],
      default: 'phone',
    },
    fields: {
      type: [ClientFieldConfigSchema],
      default: [],
    },
  },

  // 🚫 Política de cancelación de citas
  cancellationPolicy: {
    minHoursBeforeAppointment: {
      type: Number,
      default: 0,
      min: 0,
      max: 168,
    },
    preventCancellingConfirmed: {
      type: Boolean,
      default: false,
    },
  },

  // 📄 Términos y condiciones del negocio (configurables por organización)
  termsAndConditions: {
    enabled: { type: Boolean, default: false },
    text: { type: String, default: "" },
  },
});

export default mongoose.model("Organization", organizationSchema);
