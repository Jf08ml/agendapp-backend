// cron/paypalSubscriptionSyncJob.js
//
// Safety net para el webhook BILLING.SUBSCRIPTION.ACTIVATED de PayPal.
//
// Problema: cuando PayPal tarda en enviar el webhook (o falla en entregarlo),
// el usuario aprueba la suscripción pero su membresía queda en estado "pending"
// porque el endpoint /paypal/subscription-created solo crea la PaymentSession
// y espera el webhook para activar.
//
// Solución: cada 30 minutos, consultar activamente PayPal por todas las
// suscripciones con sesión "created" y sin procesar, y activar las que
// ya están ACTIVE en PayPal.
//
// Idempotencia: usa el mismo eventId que el webhook ("sub_activated_{id}"),
// por lo que si el webhook llega ANTES que el job, el PaymentEvent ya existirá
// y processPaymentEvent retornará { alreadyProcessed: true } sin duplicar nada.

import cron from "node-cron";
import PaymentSession from "../models/paymentSessionModel.js";
import paymentService from "../services/paymentService.js";

const SYNC_WINDOW_MINUTES = 30; // solo sesiones creadas en las últimas N horas
const SYNC_WINDOW_HOURS = 24;
const MIN_AGE_MINUTES = 5; // ignorar sesiones menores a N min (darle tiempo al webhook)

export const runPaypalSubscriptionSync = async () => {
  console.log("[PayPal Sync] Iniciando consulta activa de suscripciones pendientes...");

  const now = new Date();
  const minAge = new Date(now.getTime() - MIN_AGE_MINUTES * 60 * 1000);
  const maxAge = new Date(now.getTime() - SYNC_WINDOW_HOURS * 60 * 60 * 1000);

  // Buscar sesiones de suscripción creadas pero no procesadas
  // que tengan entre 5 minutos y 24 horas de antigüedad
  const pendingSessions = await PaymentSession.find({
    paymentMode: "subscription",
    status: "created",
    processed: false,
    createdAt: { $lte: minAge, $gte: maxAge },
  });

  if (pendingSessions.length === 0) {
    console.log("[PayPal Sync] No hay suscripciones pendientes.");
    return { synced: 0, alreadyActive: 0, errors: 0 };
  }

  console.log(`[PayPal Sync] Encontradas ${pendingSessions.length} sesiones pendientes.`);

  const provider = paymentService.getProvider("paypal");
  let synced = 0;
  let alreadyActive = 0;
  let errors = 0;

  for (const session of pendingSessions) {
    const subscriptionId = session.sessionId.replace("sub_", "");
    try {
      // Consultar estado actual en PayPal
      const sub = await provider.verifySubscription(subscriptionId).catch((err) => {
        // verifySubscription lanza si el estado no es ACTIVE/APPROVED
        // en ese caso simplemente no activamos
        console.warn(`[PayPal Sync] Suscripción ${subscriptionId} en estado no válido: ${err.message}`);
        return null;
      });

      if (!sub) continue;

      if (sub.status === "ACTIVE") {
        // Usar el mismo eventId que usaría el webhook para que la idempotencia funcione
        const eventId = `sub_activated_${subscriptionId}`;
        const result = await paymentService.processPaymentEvent({
          provider: "paypal",
          eventId,
          type: "BILLING.SUBSCRIPTION.ACTIVATED",
          sessionId: session.sessionId,
          amount: sub.amount,
          currency: sub.currency,
          status: "succeeded",
          subscriptionId,
          paymentMode: "subscription",
          raw: sub.raw,
        });

        if (result.alreadyProcessed) {
          console.log(`[PayPal Sync] ${subscriptionId} ya fue procesado por el webhook.`);
          alreadyActive++;
        } else {
          console.log(`[PayPal Sync] ✓ Membresía activada via sync para suscripción ${subscriptionId}`);
          synced++;
        }
      } else {
        // APPROVED pero no ACTIVE todavía (ej. primer ciclo de facturación no completado)
        console.log(`[PayPal Sync] ${subscriptionId} en estado ${sub.status}, aún no procesable.`);
      }
    } catch (err) {
      console.error(`[PayPal Sync] Error procesando suscripción ${subscriptionId}:`, err.message);
      errors++;
    }
  }

  console.log(`[PayPal Sync] Completado: ${synced} activadas, ${alreadyActive} ya activas, ${errors} errores.`);
  return { synced, alreadyActive, errors };
};

// Job: cada 30 minutos
const paypalSubscriptionSyncJob = cron.schedule(
  `*/${SYNC_WINDOW_MINUTES} * * * *`,
  async () => {
    try {
      await runPaypalSubscriptionSync();
    } catch (err) {
      console.error("[PayPal Sync] Error general en el job:", err);
    }
  },
  { scheduled: false }
);

export default paypalSubscriptionSyncJob;
