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

    // Si el agente agotó las rondas sin resolver
    hitRoundLimit: { type: Boolean, default: false },

    // Error si el proceso lanzó excepción
    error: { type: String },
  },
  { timestamps: true }
);

// Retención automática: los logs se eliminan después de 90 días
chatLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model("ChatLog", chatLogSchema);
