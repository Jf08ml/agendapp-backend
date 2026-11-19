import mongoose from "mongoose";

// Un intento de recuperar el acceso al panel de un dueño: código de 6 dígitos
// enviado por correo (con enlace directo) o por WhatsApp. Solo se guardan
// hashes. Se borra solo (TTL) cuando vence.
const accessChallengeSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    channel: { type: String, enum: ["email", "whatsapp"], required: true },
    // Snapshot del destino al que se envió (correo o teléfono), para auditoría.
    destination: { type: String, required: true },
    codeHash: { type: String, required: true },
    // Solo correo: el enlace "Entrar sin escribir el código".
    linkTokenHash: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    verifiedAt: { type: Date, default: null },
    // Tras verificar: token para el paso final (contraseña nueva o entrar).
    completionTokenHash: { type: String, default: null },
    completionExpiresAt: { type: Date, default: null },
    consumedAt: { type: Date, default: null },
    ip: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// El documento vive hasta 1 h después de vencer: sirve para contar los envíos
// de la última hora (límite por negocio) aunque el código ya no sirva.
accessChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

export default mongoose.model("AccessChallenge", accessChallengeSchema);
