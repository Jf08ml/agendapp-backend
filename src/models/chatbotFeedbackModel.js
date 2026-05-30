import mongoose from "mongoose";

const chatbotFeedbackSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },
    type: {
      type: String,
      enum: ["bug", "sugerencia", "comentario"],
      required: true,
    },
    message: {
      type: String,
      required: true,
      maxlength: 2000,
      trim: true,
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
