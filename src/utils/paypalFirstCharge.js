// utils/paypalFirstCharge.js

export const PAYPAL_SUBSCRIPTION_ACTIVATED = "BILLING.SUBSCRIPTION.ACTIVATED";
export const PAYPAL_SALE_COMPLETED = "PAYMENT.SALE.COMPLETED";

/**
 * El primer cobro de una suscripción de PayPal llega en dos avisos:
 * BILLING.SUBSCRIPTION.ACTIVATED y el primer PAYMENT.SALE.COMPLETED. Es un solo
 * pago, así que a AgenditApp Oficina IA se le envía solo con el primer aviso que
 * llegue, en cualquier orden. Los cobros siguientes (renovaciones) se envían siempre.
 *
 * Solo decide qué se envía a la Oficina: la membresía se procesa igual con los dos.
 *
 * @param {object} p
 * @param {string} p.provider
 * @param {string} p.type Tipo del aviso que se está procesando.
 * @param {string[]} p.otherEventTypes Tipos de los demás PaymentEvent con éxito de la misma suscripción.
 * @returns {boolean} true si este aviso repite un cobro que ya se envió.
 */
export function isRepeatedFirstPaypalCharge({ provider, type, otherEventTypes }) {
  if (provider !== "paypal") return false;
  const previousSales = otherEventTypes.filter((t) => t === PAYPAL_SALE_COMPLETED).length;
  if (type === PAYPAL_SUBSCRIPTION_ACTIVATED) return previousSales > 0;
  if (type === PAYPAL_SALE_COMPLETED) {
    return previousSales === 0 && otherEventTypes.includes(PAYPAL_SUBSCRIPTION_ACTIVATED);
  }
  return false;
}
