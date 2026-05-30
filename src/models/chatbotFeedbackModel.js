import mongoose from "mongoose";

const chatbotFeedbackSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    // Solo disponible en feedback del panel admin (autenticado)
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },
    // "admin"   → feedback desde el panel administrativo
    // "booking" → satisfacción post-reserva del cliente público
    source: {
      type: String,
      enum: ["admin", "booking"],
      default: "admin",
    },
    type: {
      type: String,
      enum: ["bug", "sugerencia", "comentario", "satisfaccion"],
      required: true,
    },
    // Calificación numérica 1-5 (usada en feedback de booking)
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: false,
    },
    // Comentario opcional (requerido en admin, opcional en booking)
    message: {
      type: String,
      maxlength: 2000,
      trim: true,
      required: false,
    },
    // Vincula el feedback a una sesión de chat específica
    sessionId: {
      type: String,
      required: false,
    },
    agentName: {
      type: String,
    },
  },
  { timestamps: true }
);

export default mongoose.model("ChatbotFeedback", chatbotFeedbackSchema);
