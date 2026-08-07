import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant"] },
    content: String,
  },
  { _id: false }
);

const chatLogSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    // "admin" = chatbot del staff | "booking" = chatbot público de reserva
    type: { type: String, enum: ["admin", "booking"], required: true },
    // Canal por el que ocurrió la conversación (booking puede ser web o WhatsApp)
    channel: { type: String, enum: ["web", "whatsapp"], default: "web" },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Conversación: mensajes de texto (sin bloques de tool_use internos)
    messages: [messageSchema],
    reply: { type: String },

    // Métricas de ejecución
    rounds: { type: Number, default: 0 },
    toolsUsed: [{ type: String }],
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    durationMs: { type: Number },

    // Solo para tipo "booking": payload construido por prepare_reservation
    bookingPayload: { type: mongoose.Schema.Types.Mixed },

    // Solo para tipo "booking": true cuando el cliente tocó "Sí, confirmar"
    // y la reserva se creó realmente (métrica de conversión prepare → reserva)
    reservationCreated: { type: Boolean, default: false },
    reservationCreatedAt: { type: Date },

    // Si el agente agotó las rondas sin resolver
    hitRoundLimit: { type: Boolean, default: false },

    // Error si el proceso lanzó excepción
    error: { type: String },

    // Revisión manual (superadmin) para curar ejemplos de entrenamiento/mejora de prompts
    review: {
      reviewed: { type: Boolean, default: false },
      reviewedBy: { type: String },
      reviewedAt: { type: Date },
      // Lista de opciones vive solo en el frontend (Select); sin enum aquí para
      // poder agregar categorías nuevas sin necesitar una migración.
      category: { type: String },
      notes: { type: String },
    },
  },
  { timestamps: true }
);

// Retención automática: los logs se eliminan después de 90 días, EXCEPTO los
// ya revisados (partialFilterExpression los excluye del TTL indefinidamente).
// MongoDB solo permite igualdad/$exists/comparaciones en partialFilterExpression
// (nada de $ne/$or) — por eso la igualdad exacta contra `false` en vez de $ne:true.
// Para que esto funcione siempre, todo insert nuevo de ChatLog debe fijar
// "review.reviewed": false explícitamente en su $setOnInsert (los upserts no
// aplican defaults de Mongoose solos); ver chatController.js / bookingChatController.js /
// waBookingAgentService.js.
chatLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60, partialFilterExpression: { "review.reviewed": false } }
);

export default mongoose.model("ChatLog", chatLogSchema);
