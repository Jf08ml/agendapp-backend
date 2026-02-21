/**
 * setLsVariantIds.js
 * Asigna los Lemon Squeezy variant IDs a los planes existentes en la base de datos.
 *
 * Uso: node scripts/setLsVariantIds.js
 */
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV || "development"}` });

import mongoose from "mongoose";
import Plan from "../src/models/planModel.js";

// ─── Mapeo slug → variant ID de Lemon Squeezy ──────────────────────────────
// Actualiza estos IDs con los de tu dashboard de Lemon Squeezy
const LS_VARIANT_IDS = {
  "plan-basico": "1330373",
  "plan-esencial": "1330375",
  "plan-marca-propia": "1330377",
};
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  await mongoose.connect(process.env.DB_URI);
  console.log("✅ Conectado a MongoDB");

  for (const [slug, variantId] of Object.entries(LS_VARIANT_IDS)) {
    const result = await Plan.findOneAndUpdate(
      { slug },
      { lsVariantId: variantId },
      { new: true }
    );

    if (result) {
      console.log(`✅ ${result.displayName} (${slug}) → lsVariantId: ${variantId}`);
    } else {
      console.warn(`⚠️  No se encontró ningún plan con slug: "${slug}"`);
    }
  }

  await mongoose.disconnect();
  console.log("\n✅ Listo. Planes actualizados.");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
