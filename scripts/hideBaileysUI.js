/**
 * Oculta/muestra la sección de Baileys en la UI de una org.
 * Uso: node scripts/hideBaileysUI.js <orgId> <true|false>
 *
 * Ejemplo:
 *   node scripts/hideBaileysUI.js <orgId> true
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.development") });

const [, , orgId, value] = process.argv;

if (!orgId || value === undefined) {
  console.error("Uso: node scripts/hideBaileysUI.js <orgId> <true|false>");
  process.exit(1);
}

await mongoose.connect(process.env.DB_URI);

const Organization = mongoose.model(
  "Organization",
  new mongoose.Schema({}, { strict: false, collection: "organizations" })
);

const hide = value === "true";

const updated = await Organization.findByIdAndUpdate(
  orgId,
  { hideBaileysUI: hide },
  { new: true }
);

if (!updated) {
  console.error("❌ Organización no encontrada:", orgId);
  process.exit(1);
}

console.log(`✅ hideBaileysUI = ${hide} para org ${orgId}`);

await mongoose.disconnect();
