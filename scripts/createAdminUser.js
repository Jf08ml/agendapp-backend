/**
 * Script para crear un AdminUser (superadmin de plataforma).
 * Ejecutar UNA VEZ manualmente:
 *
 *   node scripts/createAdminUser.js
 *
 * IMPORTANTE: Cambiar las credenciales antes de ejecutar en producción.
 * El script es idempotente: no duplica si el email ya existe.
 */

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = process.env.NODE_ENV || "development";
dotenv.config({ path: join(__dirname, `../.env.${env}`) });

// ─── Configuración ───────────────────────────────────────────────────────────
const ADMIN_EMAIL = "superadmin@agenditapp.com"; // Cambiar
const ADMIN_PASSWORD = "superadmin2026"; // Cambiar
const ADMIN_NAME = "Super Admin";
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const dbURI = process.env.DB_URI;
  if (!dbURI) throw new Error("DB_URI no definida en el .env");
  await mongoose.connect(dbURI);
  console.log("✓ Conectado a MongoDB");

  // Importar modelo DESPUÉS de conectar
  const { default: AdminUser } = await import("../src/models/adminUserModel.js");

  const existing = await AdminUser.findOne({ email: ADMIN_EMAIL.toLowerCase() });
  if (existing) {
    console.log(`⚠️  AdminUser con email "${ADMIN_EMAIL}" ya existe (id: ${existing._id}). Sin cambios.`);
    await mongoose.disconnect();
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const admin = await AdminUser.create({
    email: ADMIN_EMAIL.toLowerCase(),
    passwordHash,
    name: ADMIN_NAME,
    isActive: true,
  });

  console.log(`✅ AdminUser creado:`);
  console.log(`   ID:    ${admin._id}`);
  console.log(`   Email: ${admin.email}`);
  console.log(`   Nombre: ${admin.name}`);
  console.log(`\n⚠️  RECUERDA: Cambiar la password en producción antes de usar.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
