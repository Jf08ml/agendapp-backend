import mongoose from "mongoose";

const whatsappTemplateSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      unique: true,
      index: true,
    },
    // 🆕 Control de envíos - habilitar/deshabilitar mensajes automáticos
    enabledTypes: {
      type: {
        scheduleAppointment: {
          type: Boolean,
          default: true,
        },
        scheduleAppointmentBatch: {
          type: Boolean,
          default: true,
        },
        recurringAppointmentSeries: {
          type: Boolean,
          default: true,
        },
        reminder: {
          type: Boolean,
          default: true,
        },
        secondReminder: {
          type: Boolean,
          default: true,
        },
        statusReservationPending: {
          type: Boolean,
          default: true,
        },
        statusReservationApproved: {
          type: Boolean,
          default: false,
        },
        statusReservationRejected: {
          type: Boolean,
          default: false,
        },
        // 🆕 Agradecimientos/avisos al cliente
        clientConfirmationAck: {
          type: Boolean,
          default: true,
        },
        clientCancellationAck: {
          type: Boolean,
          default: true,
        },
        clientNoShowAck: {
          type: Boolean,
          default: true,
        },
        // 🏆 Notificaciones de recompensas de fidelidad
        loyaltyServiceReward: {
          type: Boolean,
          default: true,
        },
        loyaltyReferralReward: {
          type: Boolean,
          default: true,
        },
        // 📚 Módulo de Clases
        classEnrollmentConfirmed: {
          type: Boolean,
          default: true,
        },
        classEnrollmentPending: {
          type: Boolean,
          default: true,
        },
        classEnrollmentCancelled: {
          type: Boolean,
          default: true,
        },
        classReminder: {
          type: Boolean,
          default: true,
        },
        // 🎂 Saludo de cumpleaños (desactivado por defecto)
        birthdayGreeting: {
          type: Boolean,
          default: false,
        },
        // 🔁 Recordatorio de seguimiento entre servicios relacionados (desactivado por defecto)
        followUpReminder: {
          type: Boolean,
          default: false,
        },
        // 🛍️ Pago recibido (tienda pública) — transaccional, activo por defecto
        paymentReceived: {
          type: Boolean,
          default: true,
        },
        // 🔔 Mensajes del sistema (avisos al admin) — activos por defecto
        adminPaymentAlert: {
          type: Boolean,
          default: true,
        },
        adminNewOrderAlert: {
          type: Boolean,
          default: true,
        },
      },
      default: () => ({
        scheduleAppointment: true,
        scheduleAppointmentBatch: true,
        recurringAppointmentSeries: true,
        reminder: true,
        secondReminder: true,
        statusReservationPending: true,
        statusReservationApproved: false,
        statusReservationRejected: false,
        clientConfirmationAck: true,
        clientCancellationAck: true,
        clientNoShowAck: true,
        loyaltyServiceReward: true,
        loyaltyReferralReward: true,
        classEnrollmentConfirmed: true,
        classEnrollmentPending: true,
        classEnrollmentCancelled: true,
        classReminder: true,
        birthdayGreeting: false,
        followUpReminder: false,
        paymentReceived: true,
        adminPaymentAlert: true,
        adminNewOrderAlert: true,
      }),
    },
    scheduleAppointment: {
      type: String,
      default: null, // null = usar template por defecto del sistema
    },
    scheduleAppointmentBatch: {
      type: String,
      default: null,
    },
    recurringAppointmentSeries: {
      type: String,
      default: null,
    },
    reminder: {
      type: String,
      default: null,
    },
    secondReminder: {
      type: String,
      default: null,
    },
    statusReservationPending: {
      type: String,
      default: null,
    },
    statusReservationApproved: {
      type: String,
      default: null,
    },
    statusReservationRejected: {
      type: String,
      default: null,
    },
    // 🆕 Nuevas plantillas personalizables
    clientConfirmationAck: {
      type: String,
      default: null,
    },
    clientCancellationAck: {
      type: String,
      default: null,
    },
    clientNoShowAck: {
      type: String,
      default: null,
    },
    // 🏆 Templates personalizables para recompensas de fidelidad
    loyaltyServiceReward: {
      type: String,
      default: null,
    },
    loyaltyReferralReward: {
      type: String,
      default: null,
    },
    // 📚 Módulo de Clases
    classEnrollmentConfirmed: {
      type: String,
      default: null,
    },
    classEnrollmentPending: {
      type: String,
      default: null,
    },
    classEnrollmentCancelled: {
      type: String,
      default: null,
    },
    classReminder: {
      type: String,
      default: null,
    },
    // 🎂 Saludo de cumpleaños
    birthdayGreeting: {
      type: String,
      default: null, // null = usar template por defecto del sistema
    },
    // 🔁 Recordatorio de seguimiento entre servicios relacionados
    followUpReminder: {
      type: String,
      default: null, // null = usar template por defecto del sistema
    },
    // 🛍️ Pago recibido (tienda pública)
    paymentReceived: {
      type: String,
      default: null, // null = usar template por defecto del sistema
    },
    // 🔔 Mensajes del sistema (avisos al admin de la org)
    adminPaymentAlert: {
      type: String,
      default: null,
    },
    adminNewOrderAlert: {
      type: String,
      default: null,
    },
    // 🎂 Beneficio de cumpleaños (texto editable por la org; se inyecta en {{beneficio}})
    birthdayBenefit: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const WhatsappTemplate = mongoose.model("WhatsappTemplate", whatsappTemplateSchema);

export default WhatsappTemplate;
