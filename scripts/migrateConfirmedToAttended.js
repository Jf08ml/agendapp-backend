/**
 * Migration: confirmed → attended for past appointments
 *
 * Marks all 'confirmed' appointments whose startDate is in the past as 'attended'.
 * Safe to run multiple times (idempotent).
 *
 * Run: node scripts/migrateConfirmedToAttended.js
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config({ path: ".env.development" });

const APPOINTMENT_COLLECTION = "appointments";

async function run() {
  await mongoose.connect(process.env.DB_URI);
  console.log("Connected to MongoDB");

  const now = new Date();

  // Pasadas: pending/confirmed → attended
  const pastResult = await mongoose.connection
    .collection(APPOINTMENT_COLLECTION)
    .updateMany(
      { status: { $in: ["confirmed", "pending"] }, startDate: { $lt: now } },
      { $set: { status: "attended" } }
    );

  console.log(`Past updated:   ${pastResult.modifiedCount} appointments → attended`);

  // Futuras: pending → confirmed (confirmed ya es el estado correcto)
  const futureResult = await mongoose.connection
    .collection(APPOINTMENT_COLLECTION)
    .updateMany(
      { status: "pending", startDate: { $gte: now } },
      { $set: { status: "confirmed" } }
    );

  console.log(`Future updated: ${futureResult.modifiedCount} appointments pending → confirmed`);

  await mongoose.disconnect();
  console.log("Done.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
