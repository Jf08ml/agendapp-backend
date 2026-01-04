import mongoose from "mongoose";

const reservationSchema = new mongoose.Schema(
  {
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    startDate: { type: Date, required: true },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: false,
    },
    customerDetails: {
      name: { type: String, required: true },
      email: { type: String, required: false },
      phone: { type: String, required: true },
      // 🌍 Campos internacionales
      phone_e164: { type: String, required: false },
      phone_country: { type: String, required: false, maxlength: 2 },
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "auto_approved", "cancelled_by_customer", "cancelled_by_admin"],
      default: "pending",
    },
    auto: {
      type: Boolean,
      default: false,
    },
    // 🔐 Token de cancelación (hash)
    cancelTokenHash: {
      type: String,
      required: false,
    },
    cancelledAt: {
      type: Date,
      required: false,
    },
    cancelledBy: {
      type: String,
      enum: ["customer", "admin"],
      required: false,
    },
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      default: null,
    },
    // 👥 ID de grupo para reservas múltiples (mismo cliente, misma solicitud)
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
      index: true,
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

reservationSchema.index({ organizationId: 1, status: 1 });

export default mongoose.model("Reservation", reservationSchema);
