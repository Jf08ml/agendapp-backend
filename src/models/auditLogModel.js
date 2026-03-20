import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        "delete_appointment",
        "delete_client",
        "force_delete_client",
        "delete_employee",
        "delete_reservation",
        "delete_reservation_with_appointment",
      ],
    },
    entityType: {
      type: String,
      required: true,
      enum: ["appointment", "client", "employee", "reservation"],
    },
    entityId: {
      type: String,
      required: true,
    },
    // Snapshot de los datos del entity ANTES de eliminarse
    entitySnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    performedById: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    performedByName: {
      type: String,
      default: "Sistema",
    },
    performedByRole: {
      type: String,
      default: null,
    },
    // Metadata adicional (ej: si la reserva también eliminó citas vinculadas)
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    // Colección inmutable: no exponer update/delete en la app
  }
);

// Índice compuesto para queries frecuentes
auditLogSchema.index({ organizationId: 1, createdAt: -1 });
auditLogSchema.index({ organizationId: 1, entityType: 1, createdAt: -1 });

const AuditLog = mongoose.model("AuditLog", auditLogSchema);

export default AuditLog;
