/**
 * Script de recuperación: activa manualmente una membresía atascada
 * (cuando el webhook procesó el PaymentEvent pero falló en activar la membresía).
 *
 * Uso:
 *   node scripts/fixStuckMembership.js <organizationId> <planId> <paymentAmount>
 *
 * Ejemplo:
 *   node scripts/fixStuckMembership.js 6999f4e4f3b29fbf4e352226 695ef382a8dd9991f385964f 20
 */

require("@babel/register")({ extensions: [".js"] });

const { config } = require("dotenv");
config({ path: ".env.development" });

async function main() {
  const [,, organizationId, planId, paymentAmount] = process.argv;

  if (!organizationId || !planId) {
    console.error("Uso: node scripts/fixStuckMembership.js <organizationId> <planId> [paymentAmount]");
    process.exit(1);
  }

  const dbConnection = require("../src/config/db.js").default;
  const membershipService = require("../src/services/membershipService.js").default;

  await dbConnection();

  console.log(`Activando membresía...`);
  console.log(`  organizationId: ${organizationId}`);
  console.log(`  planId:         ${planId}`);
  console.log(`  paymentAmount:  ${paymentAmount || 0}`);

  const membership = await membershipService.activatePaidPlan({
    organizationId,
    planId,
    paymentAmount: paymentAmount ? Number(paymentAmount) : 0,
  });

  console.log("\n✅ Membresía activada:");
  console.log(`  _id:     ${membership._id}`);
  console.log(`  status:  ${membership.status}`);
  console.log(`  planId:  ${membership.planId}`);
  console.log(`  periodEnd: ${membership.currentPeriodEnd}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
