import mongoose from "mongoose";

const packagePaymentRecordSchema = new mongoose.Schema({
  amount: { type: Number, required: true, min: 0 },
  method: { type: String, enum: ['cash', 'card', 'transfer', 'other'], default: 'cash' },
  date: { type: Date, default: Date.now },
  note: { type: String, default: '' },
  registeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: false },
}, { _id: true });

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
    // 💰 Control de pagos del paquete
    payments: { type: [packagePaymentRecordSchema], default: [] },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'partial', 'paid'],
      default: 'unpaid',
    },
  },
  {
    timestamps: true,
  }
);

clientPackageSchema.index({ clientId: 1, organizationId: 1, status: 1 });
clientPackageSchema.index({ expirationDate: 1 });

function computePackagePaymentStatus(pkg) {
  const totalPaid = (pkg.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
  const total = pkg.totalPrice || 0;
  if (total === 0) return totalPaid > 0 ? 'paid' : 'unpaid';
  if (totalPaid >= total) return 'paid';
  if (totalPaid > 0) return 'partial';
  return 'unpaid';
}

clientPackageSchema.statics.computePaymentStatus = computePackagePaymentStatus;

clientPackageSchema.pre('save', function (next) {
  this.paymentStatus = computePackagePaymentStatus(this);
  next();
});

export default mongoose.model("ClientPackage", clientPackageSchema);
