import mongoose from "mongoose";

const clientPackageServiceSchema = new mongoose.Schema({
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Service",
    required: true,
  },
  sessionsIncluded: {
    type: Number,
    required: true,
    min: 1,
  },
  sessionsUsed: {
    type: Number,
    default: 0,
    min: 0,
  },
  sessionsRemaining: {
    type: Number,
    required: true,
    min: 0,
  },
});

const consumptionHistorySchema = new mongoose.Schema({
  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Appointment",
    required: true,
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Service",
    required: true,
  },
  action: {
    type: String,
    enum: ["consume", "refund"],
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
});

const clientPackageSchema = new mongoose.Schema(
  {
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    servicePackageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServicePackage",
      required: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    services: [clientPackageServiceSchema],
    purchaseDate: {
      type: Date,
      default: Date.now,
    },
    expirationDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "expired", "exhausted", "cancelled"],
      default: "active",
    },
    totalPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentMethod: {
      type: String,
      default: "",
    },
    paymentNotes: {
      type: String,
      default: "",
    },
    consumptionHistory: [consumptionHistorySchema],
  },
  {
    timestamps: true,
  }
);

clientPackageSchema.index({ clientId: 1, organizationId: 1, status: 1 });
clientPackageSchema.index({ expirationDate: 1 });

export default mongoose.model("ClientPackage", clientPackageSchema);
