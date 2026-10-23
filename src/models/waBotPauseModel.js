import mongoose from "mongoose";

// Pausa del agente de reservas por WhatsApp para un cliente de una org.
// reason: "client" = el cliente escribió PAUSAR · "human" = el negocio le
// respondió a mano desde la app de WhatsApp Business (smb_message_echoes).
// Persistida para que sobreviva a reinicios del servidor (antes vivía solo en
// memoria y cada despliegue reactivaba el bot en conversaciones que ya atendía
// una persona). Ver waBookingAgentService.js.
const waBotPauseSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    clientPhone: { type: String, required: true },
    until: { type: Date, required: true },
    reason: { type: String, enum: ["client", "human"], required: true },
  },
  { timestamps: true }
);

waBotPauseSchema.index({ organizationId: 1, clientPhone: 1 }, { unique: true });
// Se borra sola cuando vence la pausa.
waBotPauseSchema.index({ until: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("WaBotPause", waBotPauseSchema);
