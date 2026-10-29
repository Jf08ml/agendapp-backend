import mongoose from "mongoose";

// Envíos de mensajes pedidos por AgenditApp Oficina IA (trabajador de activación).
// messageId es único: el mismo mensaje del lote nunca se envía dos veces aunque la
// Oficina repita la llamada (timeout, reintento). El texto enviado queda en el
// inbox de superadmin (PlatformWaMessage con source "oficina").
const oficinaOutreachSendSchema = new mongoose.Schema(
  {
    messageId: { type: String, required: true, unique: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    kind: { type: String, enum: ["template", "text"], required: true },
    templateName: { type: String, default: null },
    // sending: reclamado, llamando a WhatsApp. sent: WhatsApp lo aceptó. failed: WhatsApp lo rechazó (se puede reintentar).
    status: { type: String, enum: ["sending", "sent", "failed"], required: true },
    metaMessageId: { type: String, default: null },
    error: { type: String, default: null },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("OficinaOutreachSend", oficinaOutreachSendSchema);
