import mongoose from "mongoose";

const membershipSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Plan",
      required: true,
    },

    // Estado de la membresía
    status: {
      type: String,
      enum: [
        "active",        // Activa y pagada
        "trial",         // Período de prueba
        "pending",       // Pendiente de pago
        "past_due",      // Vencida, read-only (3 días antes de suspender)
        "suspended",     // Suspendida por falta de pago
        "cancelled",     // Cancelada por el usuario
        "expired",       // Expirada
      ],
      default: "trial",
      index: true,
    },

    // Fechas importantes
    startDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    currentPeriodStart: {
      type: Date,
      required: true,
      default: Date.now,
    },
    currentPeriodEnd: {
      type: Date,
      required: false,
      default: null,
      index: true,
    },
    trialEnd: {
      type: Date,
      default: null,
    },

    // Control de notificaciones
    notifications: {
      threeDaysSent: { type: Boolean, default: false },
      oneDaySent: { type: Boolean, default: false },
      expirationSent: { type: Boolean, default: false },
      pastDueDay1Sent: { type: Boolean, default: false },
      pastDueDay2Sent: { type: Boolean, default: false },
    },

    // Historial de pagos (referencia)
    lastPaymentDate: {
      type: Date,
      default: null,
    },
    lastPaymentAmount: {
      type: Number,
      default: 0,
    },
    nextPaymentDue: {
      type: Date,
      index: true,
    },

    // Auto-renovación
    autoRenew: {
      type: Boolean,
      default: false,
    },

    // PayPal
    paypalSubscriptionId: {
      type: String,
      default: null,
      index: true,
    },
    paymentMode: {
      type: String,
      enum: ["once", "subscription"],
      default: null,
    },

    // Notas administrativas
    adminNotes: {
      type: String,
      default: "",
    },

    // Rastreo de suspensiones
    suspendedAt: {
      type: Date,
      default: null,
    },
    suspensionReason: {
      type: String,
      default: "",
    },

    // Cancelación
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancellationReason: {
      type: String,
      default: "",
    },

    // Idempotencia del cron
    lastCheckedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Índice compuesto para búsquedas eficientes
membershipSchema.index({ organizationId: 1, status: 1 });
membershipSchema.index({ currentPeriodEnd: 1, status: 1 });

const DAY_MS = 1000 * 60 * 60 * 24;
export const PAST_DUE_GRACE_DAYS = 3;
// Suscripciones PayPal: el cobro de renovación (y su webhook PAYMENT.SALE.COMPLETED)
// puede llegar horas después de currentPeriodEnd; no castigar a quien sí va a pagar.
const SUBSCRIPTION_RENEWAL_TOLERANCE_MS = DAY_MS;

// Momento exacto en que se pierde el acceso completo (inicio de past_due).
membershipSchema.methods.accessEndsAt = function() {
  if (!this.currentPeriodEnd) return null;
  const tolerance =
    this.autoRenew && this.paypalSubscriptionId ? SUBSCRIPTION_RENEWAL_TOLERANCE_MS : 0;
  return new Date(new Date(this.currentPeriodEnd).getTime() + tolerance);
};

// Estado real según las fechas, sin esperar al cron diario (que solo avisa y persiste).
// Solo escala (active → past_due → suspended), nunca relaja un estado guardado.
membershipSchema.methods.effectiveStatus = function(now = new Date()) {
  if (this.status !== "active" && this.status !== "past_due") return this.status;
  const accessEnd = this.accessEndsAt();
  if (!accessEnd || now < accessEnd) return this.status;
  if (now - accessEnd >= PAST_DUE_GRACE_DAYS * DAY_MS) return "suspended";
  return "past_due";
};

// Método para calcular días hasta vencimiento
membershipSchema.methods.daysUntilExpiration = function() {
  const now = new Date();
  const diff = this.currentPeriodEnd - now;
  // ceil: con 0–24h restantes aún queda 1 día (igual que el frontend)
  return Math.ceil(diff / DAY_MS);
};

export default mongoose.model("Membership", membershipSchema);
