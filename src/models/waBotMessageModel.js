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
  },
  { timestamps: true }
);

const WaBotMessage = mongoose.model("WaBotMessage", waBotMessageSchema);

export default WaBotMessage;
