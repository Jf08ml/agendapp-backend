// models/campaignModel.js
import { Schema, model } from "mongoose";

const campaignItemSchema = new Schema(
  {
    phone: { type: String, required: true },
    name: String,
    message: String, // Mensaje renderizado
    status: {
      type: String,
      enum: ["pending", "sent", "failed", "skipped"],
      default: "pending",
    },
    sentAt: Date,
    errorMessage: String, // Mensaje de error si falla
  },
  { _id: false }
);

const campaignSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      maxlength: 2000,
    },
    image: String, // URL or base64
    
    // Referencia al bulk del microservicio
    bulkId: {
      type: String,
      index: true,
    },
    
    status: {
      type: String,
      enum: ["draft", "dry-run", "running", "completed", "failed", "cancelled"],
      default: "draft",
      index: true,
    },
    
    isDryRun: {
      type: Boolean,
      default: false,
    },
    
    // Estadísticas
    stats: {
      total: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      pending: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },
    
    // Items detallados
    items: [campaignItemSchema],
    
    // Metadata
    startedAt: Date,
    completedAt: Date,
    cancelledAt: Date,
    
    errorMessage: String,
  },
  {
    timestamps: true,
    collection: "campaigns",
  }
);

// Índice compuesto para búsquedas eficientes
campaignSchema.index({ organizationId: 1, createdAt: -1 });
campaignSchema.index({ organizationId: 1, status: 1 });

const Campaign = model("Campaign", campaignSchema);

export default Campaign;
