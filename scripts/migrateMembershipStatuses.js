// scripts/migrateMembershipStatuses.js
// Migra membresías de "grace_period" a "past_due"
// Y actualiza Organization.membershipStatus correspondiente
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import dbConnection from "../src/config/db.js";
import Membership from "../src/models/membershipModel.js";
import Organization from "../src/models/organizationModel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(__dirname, `../.env.${process.env.NODE_ENV || "development"}`);
config({ path: envFile });

async function migrate() {
  try {
    await dbConnection();
    console.log("\n✓ Conectado a la base de datos");

    // 1. Migrar membresías grace_period → past_due
    const membershipResult = await Membership.updateMany(
      { status: "grace_period" },
      { $set: { status: "past_due" } }
    );
    console.log(`\n✅ Membresías migradas: ${membershipResult.modifiedCount} de grace_period → past_due`);

    // 2. Migrar Organization.membershipStatus
    const orgResult = await Organization.updateMany(
      { membershipStatus: "grace_period" },
      { $set: { membershipStatus: "past_due" } }
    );
    console.log(`✅ Organizaciones migradas: ${orgResult.modifiedCount} de grace_period → past_due`);

    // 3. Renombrar campos de notificaciones en membresías existentes
    const notifResult = await Membership.updateMany(
      { "notifications.gracePeriodDay1Sent": { $exists: true } },
      {
        $rename: {
          "notifications.gracePeriodDay1Sent": "notifications.pastDueDay1Sent",
          "notifications.gracePeriodDay2Sent": "notifications.pastDueDay2Sent",
        },
      }
    );
    console.log(`✅ Notificaciones renombradas: ${notifResult.modifiedCount} documentos`);

    console.log("\n✅ Migración completada.");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Error en migración:", err);
    process.exit(1);
  }
}

migrate();
