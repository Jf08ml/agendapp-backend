import mongoose from "mongoose";

// Consumo mensual del tope de "citas con WhatsApp" de planes que lo tienen
// (Plan.limits.maxWhatsappAppointmentsPerMonth). Un documento por org y mes
// (mes de la cita, en la timezone de la org). `keys` son las visitas ya
// contadas — "<groupId|appointmentId>:<YYYY-MM-DD>" — para que la confirmación
// y los recordatorios de una misma visita cuenten una sola vez. El contador no
// baja al cancelar o borrar citas: el mensaje ya salió.
const waQuotaUsageSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true },
    period: { type: String, required: true }, // "YYYY-MM"
    count: { type: Number, default: 0 },
    keys: { type: [String], default: [] },
  },
  { timestamps: true }
);

waQuotaUsageSchema.index({ organizationId: 1, period: 1 }, { unique: true });

export default mongoose.model("WaQuotaUsage", waQuotaUsageSchema);
