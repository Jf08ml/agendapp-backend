/**
 * orderService.js
 *
 * Lógica de los `Order` (cobros cliente→org). Fase 1b: cálculo del depósito de
 * reserva y creación/transición de Orders. El checkout real (preference de MP)
 * y el webhook se conectan en fases posteriores (1c/1d).
 */

import Order from "../../models/orderModel.js";

// Monedas sin decimales (el monto se cobra como entero). Foco LatAm + comunes.
const ZERO_DECIMAL_CURRENCIES = new Set(["COP", "CLP", "PYG", "JPY", "KRW"]);

/**
 * Redondea un monto según la moneda: enteros para monedas sin decimales,
 * 2 decimales para el resto.
 */
export function roundForCurrency(amount, currency) {
  const cc = String(currency || "").toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(cc)) return Math.round(amount);
  return Math.round(amount * 100) / 100;
}

/**
 * Calcula el depósito a cobrar para un conjunto de servicios de un grupo de
 * reserva, aplicando `reservationDepositPercentage` de la organización.
 *
 * @param {Object} org      Organization (necesita currency, requireReservationDeposit, reservationDepositPercentage)
 * @param {Array}  services Lista de servicios { _id, price } del grupo de reserva
 * @returns {Object} {
 *   required,        // ¿la org exige depósito?
 *   percentage,      // % aplicado
 *   currency,
 *   subtotal,        // suma de precios de los servicios
 *   total,           // depósito total a cobrar (redondeado)
 *   breakdown: [{ serviceId, price, deposit }]  // parte por servicio (suma = total)
 * }
 */
export function computeDepositForServices(org, services = []) {
  const currency = String(org?.currency || "COP").toUpperCase();
  const percentage = Number(org?.reservationDepositPercentage ?? 0);
  const required = !!org?.requireReservationDeposit && percentage > 0;

  const breakdown = (services || []).map((s) => {
    const price = Number(s?.price || 0);
    const deposit = roundForCurrency((price * percentage) / 100, currency);
    return { serviceId: s?._id ? String(s._id) : null, price, deposit };
  });

  const subtotal = breakdown.reduce((sum, b) => sum + b.price, 0);
  const total = breakdown.reduce((sum, b) => sum + b.deposit, 0);

  return { required, percentage, currency, subtotal, total, breakdown };
}

/**
 * Crea un Order para el depósito de un grupo de reserva. Setea externalReference
 * = String(_id) para hacer match en el webhook de MP. No crea la preference (eso
 * es Fase 1c).
 */
export async function createReservationOrder({
  organizationId,
  groupId,
  amount,
  currency,
  marketplaceFee = 0,
  expiresAt = null,
}) {
  const order = await Order.create({
    organizationId,
    type: "reservation",
    refId: groupId || null,
    amount,
    currency: String(currency || "COP").toUpperCase(),
    marketplaceFee,
    provider: "mercadopago",
    status: "created",
    expiresAt,
  });

  order.externalReference = String(order._id);
  await order.save();

  return order;
}

/**
 * Marca un Order como pagado de forma idempotente (ignora eventos ya procesados).
 * Devuelve { order, alreadyProcessed }.
 */
export async function markOrderPaid(orderId, { paymentId, eventId, raw } = {}) {
  const order = await Order.findById(orderId);
  if (!order) throw new Error("Order no encontrado.");

  if (eventId && order.processedEventIds?.includes(eventId)) {
    return { order, alreadyProcessed: true };
  }

  order.status = "paid";
  order.paidAt = new Date();
  if (paymentId) order.providerPaymentId = String(paymentId);
  if (eventId) order.processedEventIds.push(eventId);
  if (raw) order.raw = raw;
  await order.save();

  return { order, alreadyProcessed: false };
}

/**
 * Transición genérica de estado (failed/expired/refunded/pending).
 */
export async function setOrderStatus(orderId, status) {
  return Order.findByIdAndUpdate(orderId, { status }, { new: true });
}
