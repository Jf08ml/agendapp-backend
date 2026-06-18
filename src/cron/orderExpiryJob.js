// cron/orderExpiryJob.js
//
// Libera los "holds" de reserva cuyo pago no se completó. Cuando un Order de
// tipo reserva sigue en estado created/pending y su expiresAt ya pasó, lo
// marcamos como expired y sacamos sus reservas de "pending" (a "rejected", con
// nota) para que no queden como pendientes accionables en el panel.
//
// Si el pago se confirma, el webhook deja el Order en "paid" → este job no lo
// toca. Corre cada 5 minutos.

import cron from "node-cron";
import Order from "../models/orderModel.js";
import Reservation from "../models/reservationModel.js";
import enrollmentService from "../services/enrollmentService.js";
import { RES_STATUS } from "../constants/reservationStatus.js";

export const runOrderExpiry = async () => {
  const now = new Date();

  // Cualquier tipo de Order sin pago confirmado cuyo hold ya venció.
  const expired = await Order.find({
    type: { $in: ["reservation", "class", "package"] },
    status: { $in: ["created", "pending"] },
    expiresAt: { $lt: now },
  })
    .select("_id refId type")
    .lean();

  if (expired.length === 0) return { expired: 0 };

  console.log(`[Order Expiry] ${expired.length} hold(s) vencido(s).`);

  let count = 0;
  for (const order of expired) {
    try {
      await Order.updateOne({ _id: order._id }, { status: "expired" });

      if (order.type === "reservation" && order.refId) {
        // Sacar las reservas del grupo de "pending" para que no queden accionables.
        await Reservation.updateMany(
          { groupId: order.refId, status: RES_STATUS.PENDING, paymentStatus: "pending" },
          {
            status: RES_STATUS.REJECTED,
            errorMessage: "Reserva no confirmada: el pago del depósito no se completó a tiempo.",
          }
        );
      } else if (order.type === "class" && order.refId) {
        // Liberar el cupo retenido de la(s) inscripción(es) sin pagar.
        await enrollmentService.releaseEnrollmentHold(order.refId);
      }
      // package: no retiene cupo → basta con marcar el Order expired.

      count++;
    } catch (err) {
      console.error(`[Order Expiry] Error con Order ${order._id}:`, err.message);
    }
  }

  console.log(`[Order Expiry] ${count} hold(s) liberado(s).`);
  return { expired: count };
};

// Job: cada 5 minutos
const orderExpiryJob = cron.schedule(
  "*/5 * * * *",
  async () => {
    try {
      await runOrderExpiry();
    } catch (err) {
      console.error("[Order Expiry] Error general en el job:", err);
    }
  },
  { scheduled: false }
);

export default orderExpiryJob;
