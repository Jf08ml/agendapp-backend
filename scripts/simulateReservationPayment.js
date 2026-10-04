// scripts/simulateReservationPayment.js
//
// Simula la confirmación de pago de una reserva (lo que hace el webhook de MP),
// SALTÁNDOSE la llamada real a Mercado Pago. Útil para validar la lógica de
// confirmación end-to-end sin depender del sandbox de MP (que no coopera con
// marketplace/OAuth).
//
// Ejecuta exactamente los mismos pasos que `mpWebhook` tras un pago approved:
//   1. Busca el Order (por externalReference, o el último pending de reserva).
//   2. Aprueba el grupo de reservas → crea las citas (batch) + WhatsApp.
//   3. Marca las reservas paymentStatus=paid y el Order=paid (idempotente).
//
// Uso:
//   NODE_ENV=development node scripts/simulateReservationPayment.js [externalReference]
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV || "development"}` });

import dbConnection from "../src/config/db.js";
// Registrar modelos referenciados por populate en el flujo de citas (fuera del
// server no se auto-registran todos).
import "../src/models/roleModel.js";
import "../src/models/employeeModel.js";
import "../src/models/serviceModel.js";
import "../src/models/clientModel.js";
import "../src/models/appointmentModel.js";
import "../src/models/organizationModel.js";
import Order from "../src/models/orderModel.js";
import Reservation from "../src/models/reservationModel.js";
import reservationService from "../src/services/reservationService.js";
import * as orderService from "../src/services/collection/orderService.js";

const run = async () => {
  await dbConnection();

  const ref = process.argv[2];
  const order = ref
    ? await Order.findOne({ externalReference: ref })
    : await Order.findOne({ type: "reservation", status: { $in: ["created", "pending"] } }).sort({ createdAt: -1 });

  if (!order) {
    console.log("No se encontró un Order para simular (pasa un externalReference o crea un checkout primero).");
    process.exit(0);
  }

  console.log("▶ Order:", String(order._id), "| ref:", order.externalReference, "| status:", order.status, "| monto:", order.amount, order.currency);

  if (order.status === "paid") {
    console.log("⚠️ Este Order ya está 'paid'. Nada que simular.");
    process.exit(0);
  }

  const groupReservations = await Reservation.find({ groupId: order.refId });
  console.log(`▶ Reservas del grupo (${order.refId}):`, groupReservations.length);
  for (const r of groupReservations) {
    console.log(`   - ${r._id} status=${r.status} paymentStatus=${r.paymentStatus} appt=${r.appointmentId || "—"}`);
  }

  if (groupReservations.length === 0) {
    console.log("No hay reservas en el grupo. Abortando.");
    process.exit(0);
  }

  // === Mismo flujo que el webhook ===
  console.log("\n▶ Aprobando el grupo (crea citas + WhatsApp)...");
  await reservationService.updateReservation(String(groupReservations[0]._id), { status: "approved" });
  await Reservation.updateMany({ groupId: order.refId }, { paymentStatus: "paid" });

  console.log("▶ Marcando Order como paid (idempotente)...");
  await orderService.markOrderPaid(order._id, {
    paymentId: "SIMULATED",
    eventId: `SIMULATED-${Date.now()}`,
  });

  // === Resultado ===
  const updatedOrder = await Order.findById(order._id).lean();
  const updatedRes = await Reservation.find({ groupId: order.refId })
    .select("status paymentStatus appointmentId")
    .lean();

  console.log("\n═══ RESULTADO ═══");
  console.log("Order.status:        ", updatedOrder.status);
  console.log("Order.paidAt:        ", updatedOrder.paidAt);
  console.log("Reservas:");
  for (const r of updatedRes) {
    console.log(`   - ${r._id} status=${r.status} paymentStatus=${r.paymentStatus} appt=${r.appointmentId || "— (sin cita!)"}`);
  }
  const allApproved = updatedRes.every((r) => r.status === "approved" && r.paymentStatus === "paid" && r.appointmentId);
  console.log(allApproved ? "\n✅ Flujo de confirmación OK: reservas aprobadas, pagadas y con cita." : "\n⚠️ Revisar: alguna reserva no quedó aprobada/pagada/con cita.");
  process.exit(0);
};

run().catch((e) => { console.error("Error:", e); process.exit(1); });
