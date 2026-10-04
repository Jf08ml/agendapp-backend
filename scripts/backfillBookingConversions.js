/**
 * Backfill: marca como convertidos los ChatLog del chatbot de reserva (type:
 * "booking") cuya reserva SÍ se creó pero quedaron con reservationCreated:false.
 *
 * Causa del problema: la conversión se marcaba solo desde el frontend con un
 * POST /booking-chat/converted fire-and-forget, que se perdía si el cliente
 * cerraba la pestaña tras confirmar. El fix server-side (markChatConversion en
 * reservationController) evita que se repita; este script repara lo histórico.
 *
 * Estrategia de match (sin depender del identificador del cliente):
 *   organizationId + serviceId (+ employeeId si está) + source "ai_chatbot"
 *   + Reservation.createdAt dentro de una ventana temporal posterior al chat.
 * Compara ObjectIds guardados en ambos documentos, así que funciona aunque el
 * servicio/empleado se haya eliminado después. El teléfono se usa SOLO como
 * desempate de confirmación, nunca como llave.
 *
 * Por defecto corre en DRY-RUN (no escribe). Para aplicar:
 *   node scripts/backfillBookingConversions.js --apply
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import ChatLog from "../src/models/chatLogModel.js";
import Reservation from "../src/models/reservationModel.js";

dotenv.config({ path: ".env.development" });

const APPLY = process.argv.includes("--apply");
const WINDOW_BEFORE_MS = 5 * 60 * 1000; // 5 min antes del inicio del chat
const WINDOW_AFTER_MS = 60 * 60 * 1000; // 60 min después del último mensaje

const last10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);

async function run() {
  await mongoose.connect(process.env.DB_URI);
  console.log(`Conectado a MongoDB — modo ${APPLY ? "APPLY (escribe)" : "DRY-RUN (solo lectura)"}\n`);

  const candidates = await ChatLog.find({
    type: "booking",
    reservationCreated: { $ne: true },
    bookingPayload: { $ne: null },
  }).lean();

  console.log(`ChatLogs "booking" preparados pero sin conversión: ${candidates.length}\n`);

  let matched = 0;
  let updated = 0;
  let noMatch = 0;
  let skipped = 0;

  for (const log of candidates) {
    const payload = log.bookingPayload || {};
    const first = Array.isArray(payload.services) ? payload.services[0] : null;
    if (!first?.serviceId) {
      skipped++;
      continue;
    }

    const start = new Date(log.createdAt.getTime() - WINDOW_BEFORE_MS);
    const end = new Date((log.updatedAt || log.createdAt).getTime() + WINDOW_AFTER_MS);

    const query = {
      organizationId: log.organizationId,
      source: "ai_chatbot",
      serviceId: first.serviceId,
      createdAt: { $gte: start, $lte: end },
    };
    if (first.employeeId) query.employeeId = first.employeeId;

    const reservations = await Reservation.find(query).lean();
    if (reservations.length === 0) {
      noMatch++;
      continue;
    }

    // Desempate: 1) mismo teléfono (últimos 10 dígitos) si lo hay,
    // 2) la reserva creada más cerca del último mensaje del chat.
    const wantPhone = last10(payload.customerDetails?.phone);
    const chatEnd = (log.updatedAt || log.createdAt).getTime();
    const best = reservations
      .map((r) => ({
        r,
        phoneHit: wantPhone && last10(r.customerDetails?.phone) === wantPhone ? 1 : 0,
        delta: Math.abs(new Date(r.createdAt).getTime() - chatEnd),
      }))
      .sort((a, b) => b.phoneHit - a.phoneHit || a.delta - b.delta)[0];

    matched++;
    console.log(
      `✔ ${log.sessionId} → reserva ${best.r._id} ` +
        `(org ${log.organizationId}, phoneMatch=${best.phoneHit ? "sí" : "no"}, Δ=${Math.round(best.delta / 1000)}s)`
    );

    if (APPLY) {
      await ChatLog.updateOne(
        { _id: log._id },
        { $set: { reservationCreated: true, reservationCreatedAt: best.r.createdAt } }
      );
      updated++;
    }
  }

  console.log("\n──────── Resumen ────────");
  console.log(`Con reserva encontrada:  ${matched}`);
  console.log(`Sin reserva (legítimos): ${noMatch}`);
  console.log(`Sin payload válido:      ${skipped}`);
  if (APPLY) console.log(`ChatLogs actualizados:   ${updated}`);
  else console.log(`(DRY-RUN — no se escribió nada. Re-ejecuta con --apply para aplicar.)`);

  await mongoose.disconnect();
  console.log("\nListo.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
