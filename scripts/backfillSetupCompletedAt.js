/**
 * scripts/backfillSetupCompletedAt.js
 *
 * Corrige el funnel de activación para organizaciones que completaron la
 * configuración inicial VÍA CHATBOT antes del fix: tienen `setupCompleted: true`
 * pero `onboardingMilestones.setupCompletedAt` quedó en null (el tool
 * mark_setup_complete no lo marcaba).
 *
 * Usa `updatedAt` como aproximación del momento en que se completó (es el último
 * cambio, que en el flujo de onboarding coincide con el cierre del wizard/chat).
 *
 * Uso: NODE_ENV=production node scripts/backfillSetupCompletedAt.js
 *      (o NODE_ENV=development)
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import Organization from "../src/models/organizationModel.js";

dotenv.config({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env.development",
});

async function run() {
  await mongoose.connect(process.env.DB_URI);
  console.log("✓ Conectado a Mongo.");

  const orgs = await Organization.find({
    setupCompleted: true,
    $or: [
      { "onboardingMilestones.setupCompletedAt": null },
      { "onboardingMilestones.setupCompletedAt": { $exists: false } },
    ],
  }).select("name updatedAt createdAt onboardingMilestones");

  let updated = 0;
  for (const org of orgs) {
    const when = org.updatedAt || org.createdAt || new Date();
    await Organization.updateOne(
      { _id: org._id },
      { $set: { "onboardingMilestones.setupCompletedAt": when } }
    );
    updated++;
    console.log(`  ✓ ${org.name} (${org._id}) → setupCompletedAt = ${when.toISOString()}`);
  }

  console.log(`\n✓ Listo. ${updated} organización(es) corregida(s) de ${orgs.length} candidata(s).`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("✖ Error:", err);
  process.exit(1);
});
