import mongoose from "mongoose";

const featureRequestSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    status: {
      type: String,
      enum: ["pending", "under_review", "planned", "done", "declined"],
      default: "pending",
    },
    // Respuesta del superadmin, visible para la organización que la envió
    adminReply: { type: String, trim: true, maxlength: 2000, default: "" },
    respondedAt: { type: Date, default: null },
    // Snapshot de quién la envió dentro de la organización (admin dueño o empleado)
    submittedById: { type: mongoose.Schema.Types.ObjectId, default: null },
    submittedByName: { type: String, default: null },
    submittedByRole: { type: String, enum: ["admin", "employee"], default: null },
    // La organización la retiró de su lista activa — independiente del `status`
    // que maneja el superadmin. No se borra: el superadmin conserva el historial.
    closedByOrg: { type: Boolean, default: false },
    closedByOrgAt: { type: Date, default: null },
  },
  { timestamps: true }
);

featureRequestSchema.index({ organizationId: 1, createdAt: -1 });
featureRequestSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("FeatureRequest", featureRequestSchema);
