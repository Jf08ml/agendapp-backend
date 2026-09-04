import mongoose from "mongoose";

/**
 * Una sesión = un login en un dispositivo. `_id` es el claim `sid` embebido en
 * el JWT — permite revocar un dispositivo puntual sin tocar los demás.
 * `userId` es polimórfico: Organization._id cuando userType="admin" (la cuenta
 * propia de la org), Employee._id cuando userType="employee" — por eso no lleva
 * `ref` y se guarda `displayName` como snapshot (evita resolver la colección
 * correcta solo para listar).
 */
const sessionSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  userType: {
    type: String,
    enum: ["admin", "employee"],
    required: true,
  },
  displayName: {
    type: String,
    required: true,
  },
  ip: {
    type: String,
    default: "unknown",
  },
  userAgent: {
    type: String,
    default: "unknown",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastActiveAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 }, // TTL: Mongo borra el doc solo al llegar la fecha
  },
  revokedAt: {
    type: Date,
    default: null,
  },
});

sessionSchema.index({ organizationId: 1, revokedAt: 1, createdAt: -1 });

export default mongoose.model("Session", sessionSchema);
