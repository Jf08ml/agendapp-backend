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
      },
      default: () => ({
        scheduleAppointment: true,
        scheduleAppointmentBatch: true,
        recurringAppointmentSeries: true,
        reminder: true,
        secondReminder: true,
        statusReservationApproved: false,
        statusReservationRejected: false,
        clientConfirmationAck: true,
        clientCancellationAck: true,
        clientNoShowAck: true,
        loyaltyServiceReward: true,
        loyaltyReferralReward: true,
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
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const WhatsappTemplate = mongoose.model("WhatsappTemplate", whatsappTemplateSchema);

export default WhatsappTemplate;
