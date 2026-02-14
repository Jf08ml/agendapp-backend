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
      required: true,
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

// Método para verificar si está en período past_due
membershipSchema.methods.isInPastDue = function() {
  if (this.status !== "past_due") return false;
  const now = new Date();
  const pastDueEnd = new Date(this.currentPeriodEnd);
  pastDueEnd.setDate(pastDueEnd.getDate() + 3); // 3 días de past_due
  return now <= pastDueEnd;
};

// Método para verificar si debe ser suspendida
membershipSchema.methods.shouldBeSuspended = function() {
  if (this.status === "suspended" || this.status === "cancelled") return false;
  if (this.status !== "past_due") return false;
  const now = new Date();
  const pastDueEnd = new Date(this.currentPeriodEnd);
  pastDueEnd.setDate(pastDueEnd.getDate() + 3);
  return now > pastDueEnd;
};

// Método para calcular días hasta vencimiento
membershipSchema.methods.daysUntilExpiration = function() {
  const now = new Date();
  const diff = this.currentPeriodEnd - now;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

export default mongoose.model("Membership", membershipSchema);
