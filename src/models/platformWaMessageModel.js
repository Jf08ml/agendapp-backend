import mongoose from "mongoose";

// Log de todos los mensajes de WhatsApp del número de plataforma de AgenditApp
// (META_PLATFORM_PHONE_NUMBER_ID): retargeting saliente, respuestas del bot IA
// admin, y respuestas manuales del equipo — más los mensajes entrantes de los
// dueños de organización. Alimenta el inbox de superadmin (services/platformInboxService.js).
const platformWaMessageSchema = new mongoose.Schema(
  {
    // Solo dígitos (sin "+"), clave de la conversación — evita inconsistencias
    // de formato entre lo que llega de Meta y lo que hay guardado en Organization.
    phone: { type: String, required: true, index: true },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    direction: { type: String, enum: ["inbound", "outbound"], required: true },
    source: {
      type: String,
      enum: ["inbound", "retargeting", "ai_agent", "manual"],
      required: true,
    },
    body: { type: String, required: true },
    templateName: { type: String, default: null },
    metaMessageId: { type: String, default: null, index: true },
    read: { type: Boolean, default: false }, // solo relevante para direction: "inbound"
    // Solo relevante para direction: "outbound" — ticks de WhatsApp (sent/delivered/read)
    // que llegan por el webhook de Meta como eventos "statuses", matcheados por metaMessageId.
    status: { type: String, enum: ["sent", "delivered", "read", "failed"], default: null },
    statusUpdatedAt: { type: Date, default: null },
    repliedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
  },
  { timestamps: true }
);

platformWaMessageSchema.index({ phone: 1, createdAt: -1 });

export default mongoose.model("PlatformWaMessage", platformWaMessageSchema);
