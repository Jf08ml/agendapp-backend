/**
 * Limpia las credenciales Meta de una organización (para demo/testing).
 * Uso: node scripts/clearMetaCredentials.js <orgId>
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.development") });

const [, , orgId] = process.argv;

if (!orgId) {
  console.error("Uso: node scripts/clearMetaCredentials.js <orgId>");
  process.exit(1);
}

await mongoose.connect(process.env.DB_URI);

const Organization = mongoose.model(
  "Organization",
  new mongoose.Schema({}, { strict: false, collection: "organizations" })
);

const updated = await Organization.findByIdAndUpdate(
  orgId,
  {
    waConnectionType: null,
    metaWabaId: null,
    metaPhoneNumberId: null,
    metaAccessToken: null,
    metaPhone: null,
  },
  { new: true }
);

if (!updated) {
  console.error("❌ Organización no encontrada:", orgId);
  process.exit(1);
}

console.log("✅ Credenciales Meta limpiadas — botón 'Conectar con Facebook' visible");

await mongoose.disconnect();
