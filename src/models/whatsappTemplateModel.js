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
