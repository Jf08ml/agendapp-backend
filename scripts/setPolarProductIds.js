// scripts/setPolarProductIds.js
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import dbConnection from "../src/config/db.js";
import Plan from "../src/models/planModel.js";

// Load env relative to backend dir
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, `../.env.${process.env.NODE_ENV || "development"}`) });

// Product IDs según el entorno
const productIdsByEnv = {
  development: {
    // Sandbox/Test mode
    "plan-basico": "b8b44924-dc64-419f-9bfa-862df96fec61",
    "plan-esencial": "196a1cc9-2dbe-4a34-b551-84cd638db3f7",
    "plan-marca-propia": "55cd29fe-0481-4da6-841d-0efb328fa803",
  },
  production: {
    // Production mode
    "plan-basico": "fc62266e-d5e4-42d0-add4-8992740ad8b5",
    "plan-esencial": "99fa8797-8b2f-4b6a-9dd4-13ead497b52d",
    "plan-marca-propia": "87e06a3d-730c-49e8-a7cf-2414f0488f08",
  },
};

const env = process.env.NODE_ENV || "development";
const productIds = productIdsByEnv[env];

const mapping = [
  { slug: "plan-basico", productId: productIds["plan-basico"] },
  { slug: "plan-esencial", productId: productIds["plan-esencial"] },
  { slug: "plan-marca-propia", productId: productIds["plan-marca-propia"] },
];

async function run() {
  try {
    await dbConnection();
    console.log("\n✓ Conectado a la base de datos");
    console.log(`📦 Modo: ${env.toUpperCase()}\n`);

    for (const { slug, productId } of mapping) {
      const plan = await Plan.findOne({ slug });
      if (!plan) {
        console.warn(`⚠️  Plan no encontrado para slug: ${slug}`);
        continue;
      }
      plan.payment = plan.payment || {};
      plan.payment.productId = productId;
      await plan.save();
      console.log(`- Actualizado ${plan.displayName} [${slug}] → productId=${productId}`);
    }

    console.log("\n✅ Product IDs de Polar guardados.\n");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error actualizando productIds:", err);
    process.exit(1);
  }
}

run();
