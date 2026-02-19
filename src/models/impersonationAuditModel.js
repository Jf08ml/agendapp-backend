import mongoose from "mongoose";

/**
 * ImpersonationAudit — Registro inmutable de cada impersonación realizada.
 * No se debe permitir borrar ni modificar documentos de esta colección.
 * Retention: indefinida (o política interna del negocio).
 */
const impersonationAuditSchema = new mongoose.Schema(
  {
    // Quién hizo la impersonación
    adminUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },
    adminEmail: {
      type: String,
      required: true, // Denormalizado para queries rápidas sin join
    },

    // A quién se impersonó
    targetOrganizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    targetSlug: {
      type: String,
      required: true, // Denormalizado para legibilidad
    },

    // Contexto
    reason: {
      type: String,
      required: true,
      maxlength: 500,
    },
    ip: {
      type: String,
      default: "unknown",
    },
    userAgent: {
      type: String,
      default: "unknown",
    },
  },
  {
    timestamps: true, // createdAt automático
  }
);

// Índices para queries de auditoría
impersonationAuditSchema.index({ adminUserId: 1, createdAt: -1 });
impersonationAuditSchema.index({ targetOrganizationId: 1, createdAt: -1 });
impersonationAuditSchema.index({ createdAt: -1 }); // Para listar auditorías recientes

export default mongoose.model("ImpersonationAudit", impersonationAuditSchema);
