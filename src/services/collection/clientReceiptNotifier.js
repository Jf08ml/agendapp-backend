// services/collection/clientReceiptNotifier.js
//
// Avisos por WhatsApp al CLIENTE sobre su comprobante de pago cuando no se
// resuelve al instante: quedó en revisión manual del negocio, o el negocio lo
// rechazó. (La aprobación ya le llega como la confirmación normal de su cita.)
// Antes el cliente solo veía la pantalla de espera en la web y, si cerraba la
// página o había reservado por el bot de WhatsApp, no se enteraba de nada.
// Best-effort: nunca lanza ni bloquea el flujo del comprobante.

import Reservation from "../../models/reservationModel.js";
import Enrollment from "../../models/enrollmentModel.js";
import Client from "../../models/clientModel.js";
import whatsappService from "../sendWhatsappService.js";

// Nombre y teléfono del cliente según el tipo de orden.
async function resolveOrderCustomer(order) {
  if (order.type === "reservation" && order.refId) {
    const r = await Reservation.findOne({ groupId: order.refId }).select("customerDetails").lean();
    return { name: r?.customerDetails?.name, phone: r?.customerDetails?.phone };
  }
  if (order.type === "class" && order.refId) {
    const e = await Enrollment.findOne({ groupId: order.refId }).select("attendee").lean();
    return { name: e?.attendee?.name, phone: e?.attendee?.phone_e164 || e?.attendee?.phone };
  }
  if (order.type === "package" && order.metadata?.clientId) {
    const c = await Client.findById(order.metadata.clientId).select("name phone_e164 phoneNumber").lean();
    return { name: c?.name, phone: c?.phone_e164 || c?.phoneNumber };
  }
  if (order.type === "store") {
    return { name: order.store?.customer?.name, phone: order.store?.customer?.phone };
  }
  return {};
}

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

function buildMessage(outcome, order, orgName, name) {
  const hello = firstName(name) ? `Hola ${firstName(name)} 👋` : "Hola 👋";
  const isBooking = order.type === "reservation" || order.type === "class";
  if (outcome === "in_review") {
    return (
      `${hello} Recibimos tu comprobante de pago. El equipo de *${orgName}* lo está revisando ` +
      `y te confirmamos por aquí apenas quede validado.` +
      (isBooking ? " Mientras tanto tu cupo sigue apartado." : "")
    );
  }
  return (
    `${hello} El equipo de *${orgName}* no pudo validar tu comprobante de pago` +
    (isBooking ? ", así que tu reserva no quedó confirmada." : ".") +
    " Si crees que es un error, respóndenos por aquí."
  );
}

/**
 * @param {"in_review"|"rejected"} outcome
 */
export async function notifyClientReceipt({ org, order, outcome }) {
  try {
    const { name, phone } = await resolveOrderCustomer(order);
    if (!phone) return;
    const text = buildMessage(outcome, order, (org?.name || "").trim(), name);
    await whatsappService.sendMessage(String(org._id), phone, text);
  } catch (err) {
    // Sin ventana de 24 h en Meta, sin sesión de WhatsApp, etc.: el cliente
    // igual ve el estado en la página de pago.
    console.warn(`[clientReceiptNotifier] No se pudo avisar al cliente (${outcome}):`, err?.message || err);
  }
}

export default { notifyClientReceipt };
