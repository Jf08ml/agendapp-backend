import mongoose from "mongoose";

/**
 * AdminUser — Usuarios de plataforma (superadmins de AgenditApp).
 * Son completamente independientes de las Organization.
 * Colección pequeña, gestionada manualmente vía script o backoffice.
 */
const adminUserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("AdminUser", adminUserSchema);
