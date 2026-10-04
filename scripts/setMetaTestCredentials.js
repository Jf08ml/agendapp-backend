/**
 * Configura las credenciales Meta de prueba en una organización.
 * Uso: node scripts/setMetaTestCredentials.js <orgId> <wabaId>
 *
 * Ejemplo:
 *   node scripts/setMetaTestCredentials.js 64a1b2c3d4e5f6 123456789012345
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.development") });

const [, , orgId, wabaId] = process.argv;

if (!orgId || !wabaId) {
  console.error("Uso: node scripts/setMetaTestCredentials.js <orgId> <wabaId>");
  process.exit(1);
}

const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_PHONE = process.env.META_AGENDITAPP_PHONE;

if (!PHONE_NUMBER_ID || !ACCESS_TOKEN || !META_PHONE) {
  console.error("Faltan META_PHONE_NUMBER_ID, META_ACCESS_TOKEN o META_AGENDITAPP_PHONE en .env.development");
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
    waConnectionType: "meta",
    metaWabaId: wabaId,
    metaPhoneNumberId: PHONE_NUMBER_ID,
    metaAccessToken: ACCESS_TOKEN,
    metaPhone: META_PHONE,
  },
  { new: true }
);

if (!updated) {
  console.error("❌ Organización no encontrada:", orgId);
  process.exit(1);
}

console.log("✅ Credenciales Meta configuradas:");
console.log("   Org ID       :", orgId);
console.log("   WABA ID      :", wabaId);
console.log("   Phone Number :", META_PHONE);
console.log("   waConnectionType: meta");

await mongoose.disconnect();
