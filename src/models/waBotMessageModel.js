import mongoose from "mongoose";

const waBotMessageSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    role: {
      type: String,
      required: true,
      enum: ["user", "assistant"],
    },
    content: {
      type: String,
      required: true,
    },

    // Solo en mensajes "assistant": consumo de tokens de la(s) llamada(s) a
    // Claude que generaron esta respuesta (puede ser >1 ronda de tool use).
    inputTokens: { type: Number },
    outputTokens: { type: Number },

    // Revisión manual (superadmin) — se aplica con updateMany a todos los
    // mensajes de una sesión, así el filtro parcial del TTL de abajo exime a
    // la sesión completa una vez revisada.
    review: {
      reviewed: { type: Boolean, default: false },
      reviewedBy: { type: String },
      reviewedAt: { type: Date },
      category: { type: String },
      notes: { type: String },
    },
  },
  { timestamps: true }
);

// Retención automática: 90 días, salvo mensajes de sesiones ya revisadas.
// Este modelo no tenía TTL — crecía sin límite. Igualdad exacta contra `false`
// (no $ne:true — MongoDB no permite $ne en partialFilterExpression). Cada mensaje
// se crea vía WaBotMessage.create() (waAgentChatService.js), que sí aplica el
// default del schema (reviewed: false) automáticamente, a diferencia de los
// upserts de ChatLog.
waBotMessageSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60, partialFilterExpression: { "review.reviewed": false } }
);

const WaBotMessage = mongoose.model("WaBotMessage", waBotMessageSchema);

export default WaBotMessage;
