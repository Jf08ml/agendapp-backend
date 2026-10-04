/**
 * scripts/dedupeTrialMemberships.js
 *
 * Limpia las membresías HUÉRFANAS que dejó el bug anterior: al vencer el trial se
 * creaba una membresía nueva (plan gratuito) y la de trial quedaba en "expired",
 * dejando 2 docs por org. El fix ya actualiza la membresía in-place; este script
 * borra las viejas huérfanas que quedaron.
 *
 * SEGURO: solo borra membresías que cumplen TODO:
 *   - status: "expired"
 *   - plan = plan-demo (trial)
 *   - nunca tuvieron pago (lastPaymentDate null y lastPaymentAmount 0)
 *   - NO son la currentMembershipId de su organización (no se borra la activa)
 * Así no toca historial de planes pagos ni la membresía vigente.
 *
 * Por defecto corre en modo DRY-RUN (solo lista). Para borrar de verdad:
 *   NODE_ENV=production node scripts/dedupeTrialMemberships.js --apply
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import Membership from "../src/models/membershipModel.js";
import Plan from "../src/models/planModel.js";
import Organization from "../src/models/organizationModel.js";

dotenv.config({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env.development",
});

const APPLY = process.argv.includes("--apply");

async function run() {
  await mongoose.connect(process.env.DB_URI);
  console.log(`✓ Conectado a Mongo. Modo: ${APPLY ? "APLICAR (borra)" : "DRY-RUN (solo lista)"}`);

  const demoPlan = await Plan.findOne({ slug: "plan-demo" }).select("_id");
  if (!demoPlan) {
    console.error("✖ No se encontró el plan 'plan-demo'. Aborta.");
    process.exit(1);
  }

  // Candidatas: trial expired, nunca pagadas.
  const candidates = await Membership.find({
    planId: demoPlan._id,
    status: "expired",
    $and: [
      { $or: [{ lastPaymentDate: null }, { lastPaymentDate: { $exists: false } }] },
      { $or: [{ lastPaymentAmount: 0 }, { lastPaymentAmount: { $exists: false } }] },
    ],
  }).select("_id organizationId");

  let toDelete = [];
  for (const m of candidates) {
    const org = await Organization.findById(m.organizationId).select("currentMembershipId name");
    if (!org) continue; // org borrada → la membresía es basura igualmente, pero la dejamos por seguridad
    // No borrar si ES la membresía vigente de la org.
    if (org.currentMembershipId && String(org.currentMembershipId) === String(m._id)) continue;
    toDelete.push({ id: m._id, org: org.name, orgId: String(org._id) });
  }

  console.log(`\nHuérfanas encontradas: ${toDelete.length}`);
  toDelete.forEach((d) => console.log(`  - ${d.org} (org ${d.orgId}) → membership ${d.id}`));

  if (APPLY && toDelete.length > 0) {
    const ids = toDelete.map((d) => d.id);
    const res = await Membership.deleteMany({ _id: { $in: ids } });
    console.log(`\n✓ Borradas ${res.deletedCount} membresía(s) huérfana(s).`);
  } else if (!APPLY) {
    console.log("\n(DRY-RUN) No se borró nada. Re-ejecuta con --apply para borrar.");
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("✖ Error:", err);
  process.exit(1);
});
