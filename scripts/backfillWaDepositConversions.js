/**
 * Backfill: marca como convertidos los ChatLog del agente de reservas por
 * WhatsApp cuyo abono SÍ se pagó pero quedaron con reservationCreated:false.
 *
 * Causa: en WhatsApp, cuando el negocio pide abono, confirm_reservation solo
 * aparta el horario (Order + Reservation pendientes); la reserva se aprueba al
 * pagarse, en fulfillmentService, que no sabía de qué chat venía. Desde
 * 2026-10-26 el Order guarda metadata.chatSessionId y fulfillment marca la
 * conversión; este script repara lo histórico.
 *
 * Match, en este orden:
 *   1. waState.pendingDeposit.externalReference del ChatLog (persistido desde
 *      2026-10-23) → Order pagado.
 *   2. Respaldo: Reservation con source "ai_chatbot" y el mismo teléfono del
 *      cliente (phone_e164), creada durante la conversación, cuyo Order está pagado.
 *
 * Por defecto corre en DRY-RUN (no escribe). Para aplicar:
 *   node scripts/backfillWaDepositConversions.js --apply   (NODE_ENV=production para prod)
 */
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV || "development"}` });

import mongoose from "mongoose";
import ChatLog from "../src/models/chatLogModel.js";
import Order from "../src/models/orderModel.js";
import Reservation from "../src/models/reservationModel.js";

const APPLY = process.argv.includes("--apply");
const WINDOW_AFTER_MS = 60 * 60 * 1000; // el apartado puede ocurrir hasta 1 h después del último mensaje guardado

async function findPaidOrder(log) {
  const ref = log.waState?.pendingDeposit?.externalReference;
  if (ref) {
    const order = await Order.findOne({ externalReference: ref, status: "paid" }).lean();
    if (order) return { order, via: "externalReference" };
  }

  if (!log.clientPhone) return null;
  const reservations = await Reservation.find({
    organizationId: log.organizationId,
    source: "ai_chatbot",
    "customerDetails.phone_e164": log.clientPhone,
    orderId: { $ne: null },
    createdAt: { $gte: log.createdAt, $lte: new Date(log.updatedAt.getTime() + WINDOW_AFTER_MS) },
  })
    .select("orderId")
    .lean();
  for (const r of reservations) {
    const order = await Order.findOne({ _id: r.orderId, status: "paid" }).lean();
    if (order) return { order, via: "teléfono + ventana" };
  }
  return null;
}

async function run() {
  await mongoose.connect(process.env.DB_URI);
  console.log(APPLY ? "Modo APPLY — se escribirá en la base." : "Modo DRY-RUN — no se escribe nada (usa --apply).");

  const logs = await ChatLog.find({
    type: "booking",
    channel: "whatsapp",
    reservationCreated: { $ne: true },
  })
    .select("sessionId organizationId clientPhone waState createdAt updatedAt")
    .lean();
  console.log(`Sesiones de WhatsApp sin conversión: ${logs.length}`);

  let matched = 0;
  for (const log of logs) {
    const found = await findPaidOrder(log);
    if (!found) continue;
    matched++;
    const at = found.order.paidAt || found.order.updatedAt;
    console.log(`  ✓ ${log.sessionId} (${log.clientPhone || "sin teléfono"}) → Order ${found.order._id} pagado ${at?.toISOString()} [${found.via}]`);
    if (APPLY) {
      await ChatLog.updateOne(
        { _id: log._id, reservationCreated: { $ne: true } },
        { $set: { reservationCreated: true, reservationCreatedAt: at || new Date() } }
      );
    }
  }

  console.log(`${APPLY ? "Marcadas" : "Se marcarían"}: ${matched}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
