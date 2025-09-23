import mongoose from "mongoose";

const additionalItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
});

const appointmentModelSchema = new mongoose.Schema(
  {
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: true,
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    employeeRequestedByClient: {
      type: Boolean,
      required: true,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled"],
      default: "pending",
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    reminderSent: { type: Boolean, default: false },
    advancePayment: {
      type: Number,
      default: 0,
    },
    customPrice: {
      type: Number,
      default: null,
    },
    additionalItems: [additionalItemSchema],
    totalPrice: {
      type: Number,
      required: true,
    },
    groupId: { type: mongoose.Schema.Types.ObjectId, index: true },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Appointment", appointmentModelSchema);
