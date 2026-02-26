import mongoose from "mongoose";

const additionalItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
});

const paymentRecordSchema = new mongoose.Schema({
  amount: { type: Number, required: true, min: 0 },
  method: { type: String, enum: ['cash', 'card', 'transfer', 'other'], default: 'cash' },
  date: { type: Date, default: Date.now },
  note: { type: String, default: '' },
  registeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: false },
}, { _id: true });

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
      enum: ["pending", "confirmed", "cancelled", "cancelled_by_customer", "cancelled_by_admin", "attended", "no_show"],
      default: "pending",
    },
    // ✅ Confirmación del cliente (independiente del status administrativo)
    clientConfirmed: {
      type: Boolean,
      default: false,
    },
    clientConfirmedAt: {
      type: Date,
      required: false,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    // 🔗 Enlace público para confirmar o cancelar (mismo token)
    cancellationLink: {
      type: String,
      required: false,
    },
    // 🔐 Campos de cancelación
    cancelTokenHash: {
      type: String,
      required: false,
      select: false, // No incluir en queries por defecto (seguridad)
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
    reminderSent: { type: Boolean, default: false },
    reminderBulkId: { type: String },
    secondReminderSent: { type: Boolean, default: false },
    secondReminderBulkId: { type: String },
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
    clientPackageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClientPackage",
      default: null,
    },
    // 💰 Control de pagos
    payments: { type: [paymentRecordSchema], default: [] },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'partial', 'paid', 'free'],
      default: 'unpaid',
    },
    groupId: { type: mongoose.Schema.Types.ObjectId, index: true },
    // 🔁 Campos para citas recurrentes
    seriesId: { 
      type: mongoose.Schema.Types.ObjectId, 
      index: true
    },
    occurrenceNumber: { 
      type: Number
    },
    recurrencePattern: {
      type: {
        type: String,
        enum: ['weekly', 'none'],
        default: 'none'
      },
      intervalWeeks: { 
        type: Number,
        min: 1,
        max: 52
      },
      weekdays: { 
        type: [Number],
        validate: {
          validator: function(arr) {
            return arr.every(day => day >= 0 && day <= 6);
          },
          message: 'Weekdays debe contener números entre 0 (Domingo) y 6 (Sábado)'
        }
      },
      endType: {
        type: String,
        enum: ['date', 'count']
      },
      endDate: { 
        type: Date
      },
      count: { 
        type: Number,
        min: 1,
        max: 100
      }
    }
  },
  {
    timestamps: true,
  }
);

// 💰 Calcula paymentStatus a partir de los campos de pago
function computePaymentStatus(appt) {
  if (appt.clientPackageId && appt.totalPrice === 0) return 'free';
  const totalPaid =
    (appt.advancePayment || 0) +
    (appt.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
  const total = appt.totalPrice || 0;
  if (total === 0) return totalPaid > 0 ? 'paid' : 'unpaid';
  if (totalPaid >= total) return 'paid';
  if (totalPaid > 0) return 'partial';
  return 'unpaid';
}

appointmentModelSchema.statics.computePaymentStatus = computePaymentStatus;

// Recalcular paymentStatus automáticamente al guardar
appointmentModelSchema.pre('save', function (next) {
  this.paymentStatus = computePaymentStatus(this);
  next();
});

export default mongoose.model("Appointment", appointmentModelSchema);
