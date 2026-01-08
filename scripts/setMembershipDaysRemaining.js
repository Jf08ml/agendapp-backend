import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import dbConnection from "../src/config/db.js";
import membershipModel from "../src/models/membershipModel.js";

// Load env relative to backend dir
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, `../.env.${process.env.NODE_ENV || "development"}`) });

async function run() {
  const args = process.argv.slice(2);
  const [organizationId, daysStr] = args;
  const days = Number(daysStr || 1);

  if (!organizationId) {
    console.error("Usage: node scripts/setMembershipDaysRemaining.js <organizationId> [daysRemaining]");
    process.exit(1);
  }

  try {
    await dbConnection();
    console.log("\n✓ Conectado a la base de datos");

    const membership = await membershipModel
      .findOne({ organizationId })
      .sort({ createdAt: -1 });

    if (!membership) {
      console.error("No se encontró membresía para la organización", organizationId);
      process.exit(1);
    }

    const now = new Date();
    const targetEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    membership.currentPeriodEnd = targetEnd;
    membership.nextPaymentDue = targetEnd;
    await membership.save();

    console.log(`- Actualizada membresía ${membership._id} → currentPeriodEnd=${targetEnd.toISOString()} (${days} día(s) restantes)`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Error actualizando membresía:", err);
    process.exit(1);
  }
}

run();
