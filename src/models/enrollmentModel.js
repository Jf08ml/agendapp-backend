import { Schema, Types, model } from "mongoose";

const paymentRecordSchema = new Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    method: {
      type: String,
      enum: ["cash", "card", "transfer", "other"],
      default: "cash",
    },
    date: { type: Date, default: Date.now },
    note: { type: String, default: "" },
    registeredBy: { type: Types.ObjectId, ref: "Employee", required: false },
  },
  { _id: true }
);

const enrollmentSchema = new Schema(
  {
    sessionId: { type: Types.ObjectId, ref: "ClassSession", required: true },
    classId: { type: Types.ObjectId, ref: "Class", required: true },
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true },
    // Vincula inscripciones creadas en la misma solicitud (ej: titular + acompañante)
    groupId: { type: Types.ObjectId, index: true, default: null },
    // Referencia al cliente registrado (si existe)
    clientId: { type: Types.ObjectId, ref: "Client", default: null },
    // Datos del asistente
    attendee: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
      phone_e164: { type: String, default: null },
      phone_country: { type: String, maxlength: 2, default: null },
      email: { type: String, default: null },
    },
    // Precio base al momento de inscribirse
    pricePerPerson: { type: Number, required: true, min: 0 },
    // Descuento grupal aplicado (0 si reservó solo)
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    // Precio final que paga este asistente
    totalPrice: { type: Number, required: true, min: 0 },
    // Pagos registrados
    payments: { type: [paymentRecordSchema], default: [] },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "partial", "paid", "free"],
      default: "unpaid",
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled", "attended", "no_show"],
      default: "pending",
    },
    // Modo de aprobación al momento de crear la inscripción
    approvalMode: { type: String, enum: ["manual", "auto"], default: "manual" },
    // Token de cancelación (hash SHA-256, excluido de queries por defecto)
    cancelTokenHash: { type: String, select: false },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, enum: ["customer", "admin"], default: null },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

enrollmentSchema.index({ organizationId: 1, status: 1 });
enrollmentSchema.index({ sessionId: 1, status: 1 });
enrollmentSchema.index({ clientId: 1 });

// Recalcula paymentStatus antes de guardar (mismo patrón que Appointment)
enrollmentSchema.pre("save", function (next) {
  const totalPaid = (this.payments || []).reduce(
    (sum, p) => sum + (p.amount || 0),
    0
  );
  const total = this.totalPrice || 0;
  if (total === 0) {
    this.paymentStatus = "free";
  } else if (totalPaid >= total) {
    this.paymentStatus = "paid";
  } else if (totalPaid > 0) {
    this.paymentStatus = "partial";
  } else {
    this.paymentStatus = "unpaid";
  }
  next();
});

export default model("Enrollment", enrollmentSchema);
