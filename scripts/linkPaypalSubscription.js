/**
 * Script de recuperación: vincula una suscripción PayPal huérfana a su organización.
 *
 * Caso: el cliente pagó en PayPal pero POST /payments/paypal/subscription-created
 * no llegó a crear la PaymentSession (sub_<id>). Sin esa sesión, el webhook
 * BILLING.SUBSCRIPTION.ACTIVATED falla con "Payment session ... not found" y el
 * cron de sync no la ve.
 *
 * El script verifica la suscripción en PayPal, deduce el plan por su paypalPlanId,
 * crea la sesión y, si la suscripción está ACTIVE, activa la membresía con el mismo
 * eventId que usaría el webhook (idempotente: los reintentos de PayPal no duplican).
 *
 * Uso (las credenciales de PayPal live están en .env.production):
 *   NODE_ENV=production node scripts/linkPaypalSubscription.js <slug|organizationId> <subscriptionId>
 *
 * Ejemplo:
 *   NODE_ENV=production node scripts/linkPaypalSubscription.js mibarberia I-XXXXXXXXXXXX
 */

require("@babel/register")({ extensions: [".js"] });

const { config } = require("dotenv");
config({ path: `.env.${process.env.NODE_ENV || "development"}` });

async function main() {
  const [, , orgRef, subscriptionId] = process.argv;

  if (!orgRef || !subscriptionId) {
    console.error("Uso: node scripts/linkPaypalSubscription.js <slug|organizationId> <subscriptionId>");
    process.exit(1);
  }

  const mongoose = require("mongoose");
  const dbConnection = require("../src/config/db.js").default;
  const Organization = require("../src/models/organizationModel.js").default;
  const Plan = require("../src/models/planModel.js").default;
  const Membership = require("../src/models/membershipModel.js").default;
  const paymentService = require("../src/services/paymentService.js").default;

  await dbConnection();

  const org = mongoose.isValidObjectId(orgRef)
    ? await Organization.findById(orgRef)
    : await Organization.findOne({ slug: orgRef });
  if (!org) throw new Error(`Organización no encontrada: ${orgRef}`);
  console.log(`Organización: ${org.name} (${org._id})`);

  const provider = paymentService.getProvider("paypal");
  console.log(`PayPal mode:  ${provider.mode}`);
  const sub = await provider.verifySubscription(subscriptionId);
  console.log(`Suscripción:  ${subscriptionId} → ${sub.status}, plan PayPal ${sub.paypalPlanId}, ${sub.amount} ${sub.currency}`);

  const plan = await Plan.findOne({ paypalPlanId: sub.paypalPlanId });
  if (!plan) throw new Error(`Ningún Plan tiene paypalPlanId=${sub.paypalPlanId}`);
  console.log(`Plan:         ${plan.name} (${plan._id})`);

  const session = await paymentService.recordSubscription({
    subscriptionId,
    organizationId: org._id,
    planId: plan._id,
    amount: sub.amount,
    currency: sub.currency,
  });
  console.log(`Sesión:       ${session.sessionId} (${session.status})`);

  if (sub.status !== "ACTIVE") {
    console.log("La suscripción aún no está ACTIVE; el webhook o el cron de sync la activarán.");
    return;
  }

  const result = await paymentService.processPaymentEvent({
    provider: "paypal",
    eventId: `sub_activated_${subscriptionId}`,
    type: "BILLING.SUBSCRIPTION.ACTIVATED",
    sessionId: session.sessionId,
    amount: sub.amount,
    currency: sub.currency,
    status: "succeeded",
    subscriptionId,
    paymentMode: "subscription",
    raw: sub.raw,
  });
  console.log(result.alreadyProcessed ? "Ya estaba procesada." : "✓ Membresía activada.");

  const membership = await Membership.findOne({ organizationId: org._id }).sort({ createdAt: -1 });
  console.log(`Membresía:    ${membership?.status}, vence ${membership?.currentPeriodEnd?.toISOString()}`);
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
