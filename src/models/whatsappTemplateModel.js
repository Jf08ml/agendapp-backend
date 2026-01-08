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
        statusReservationApproved: {
          type: Boolean,
          default: false,
        },
        statusReservationRejected: {
          type: Boolean,
          default: false,
        },
      },
      default: () => ({
        scheduleAppointment: true,
        scheduleAppointmentBatch: true,
        recurringAppointmentSeries: true,
        reminder: true,
        statusReservationApproved: false,
        statusReservationRejected: false,
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
    reminder: {
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
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const WhatsappTemplate = mongoose.model("WhatsappTemplate", whatsappTemplateSchema);

export default WhatsappTemplate;
