/**
 * collectionController.js
 *
 * Endpoints de conexión de la cuenta de cobro (Mercado Pago) de cada organización.
 * - connect:   devuelve la URL de autorización OAuth (admin autenticado).
 * - callback:  recibe el code de MP y guarda las credenciales (público; identifica
 *              la org por el `state` firmado, no por auth).
 * - status / disconnect: gestión desde el panel admin.
 */

import mongoose from "mongoose";
import moment from "moment-timezone";
import sendResponse from "../utils/sendResponse.js";
import * as mpConnect from "../services/collection/mpConnectService.js";
import * as orderService from "../services/collection/orderService.js";
import * as mpProvider from "../services/collection/providers/MercadoPagoCollectionProvider.js";
import reservationService from "../services/reservationService.js";
import enrollmentService from "../services/enrollmentService.js";
import packageService from "../services/packageService.js";
import { fulfillOrder } from "../services/collection/fulfillmentService.js";
import Organization from "../models/organizationModel.js";
import Service from "../models/serviceModel.js";
import Reservation from "../models/reservationModel.js";
import Enrollment from "../models/enrollmentModel.js";
import ServicePackage from "../models/servicePackageModel.js";
import { resolveBaseUrl } from "../utils/cancellationUtils.js";
import Order from "../models/orderModel.js";

// Minutos que se retiene el cupo mientras el cliente paga (hold).
const HOLD_MINUTES = 15;

/**
 * Crea la preference de MP para un Order ya persistido y la vincula al Order.
 * Centraliza la lógica de back_urls por-dominio (compartida por reserva/clase/
 * paquete). El comprador vuelve siempre a `/reserva/pago` (la pantalla de retorno
 * adapta el copy según el tipo de Order). Devuelve la preference.
 */
async function buildAndAttachCheckout({ org, order, title, expiresAt }) {
  const { accessToken } = await mpConnect.getSellerToken(org._id);

  // Dominio/subdominio propio de la org (dominio custom > slug > FRONTEND_BASE_URL).
  const base = resolveBaseUrl(org);
  // MP rechaza back_urls no públicas (localhost/127.0.0.1) → solo si la base es pública.
  const isPublicBase =
    /^https:\/\//i.test(base) ||
    (/^http:\/\//i.test(base) && !/localhost|127\.0\.0\.1/i.test(base));
  const ref = order.externalReference;
  const backUrls = isPublicBase
    ? {
        success: `${base}/reserva/pago?status=success&ref=${ref}`,
        failure: `${base}/reserva/pago?status=failure&ref=${ref}`,
        pending: `${base}/reserva/pago?status=pending&ref=${ref}`,
      }
    : undefined;

  const pref = await mpProvider.createCheckout({
    amount: order.amount,
    currency: order.currency,
    externalReference: ref,
    sellerToken: accessToken,
    marketplaceFee: 0,
    backUrls,
    notificationUrl: process.env.MP_WEBHOOK_URL
      ? `${process.env.MP_WEBHOOK_URL}?org=${org._id}`
      : undefined,
    title,
    expirationDate: expiresAt ? moment(expiresAt).toISOString() : null,
  });

  order.providerPrefId = pref.id;
  order.checkoutUrl = pref.checkoutUrl;
  order.status = "pending";
  order.raw = pref.raw;
  await order.save();

  return pref;
}

// GET /organizations/:id/mp/connect  → { url }
export const getMpConnectUrl = async (req, res) => {
  try {
    const { url } = await mpConnect.buildAuthUrl(req.params.id);
    return sendResponse(res, 200, { url }, "URL de conexión generada.");
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

// GET /mp/oauth/callback?code=...&state=...  → redirige al panel
export const mpOauthCallback = async (req, res) => {
  const { code, state, error } = req.query;
  // Redirige al panel de la org en su propio dominio/subdominio cuando lo conocemos
  // (así el admin no pierde su sesión, que vive por-origen). Fallback al global.
  const back = (status, organization) =>
    res.redirect(`${resolveBaseUrl(organization)}/informacion-negocio?mp=${status}`);

  if (error || !code || !state) return back("error");

  try {
    const { orgId } = await mpConnect.handleCallback(String(code), String(state));
    const org = await Organization.findById(orgId).select("domains slug").lean();
    return back("connected", org);
  } catch (err) {
    console.error("[mpOauthCallback]", err.response?.data || err.message);
    return back("error");
  }
};

// POST /reservations/checkout  → { checkoutUrl, orderId, externalReference, amount, currency }
// Crea las reservas en pending (hold), un Order y la preference de MP a nombre
// del vendedor. NO crea las citas: eso ocurre cuando el webhook confirma el pago
// (Fase 1d). Público/semi (igual que /reservations/multi).
export const createReservationCheckout = async (req, res) => {
  const { services, startDate, customerDetails, organizationId, source } = req.body;

  if (!Array.isArray(services) || services.length === 0) {
    return sendResponse(res, 400, null, "Debe enviar al menos un servicio.");
  }
  if (!startDate || !customerDetails?.name || !customerDetails?.phone || !organizationId) {
    return sendResponse(res, 400, null, "Datos incompletos para el checkout.");
  }

  try {
    const org = await Organization.findById(organizationId);
    if (!org) return sendResponse(res, 404, null, "Organización no encontrada.");
    if (!org.mpCollect?.connected) {
      return sendResponse(res, 400, null, "La organización no tiene Mercado Pago conectado.");
    }

    // Cargar servicios (precio + duración) y preservar el orden enviado.
    const serviceIds = services.map((s) => s.serviceId);
    const docs = await Service.find({ _id: { $in: serviceIds } }).lean();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    const withPrice = services.map((s) => {
      const doc = byId.get(String(s.serviceId));
      if (!doc) throw new Error("Servicio no encontrado.");
      return { _id: doc._id, price: Number(doc.price || 0), duration: s.duration || doc.duration || 0 };
    });

    // Calcular depósito.
    const deposit = orderService.computeDepositForServices(org, withPrice);
    if (!deposit.required || deposit.total <= 0) {
      return sendResponse(res, 400, null, "La organización no exige depósito o el monto es 0.");
    }

    const timezone = org.timezone || "America/Bogota";
    const bookingSource = ["ai_chatbot", "manual_booking", "admin"].includes(source) ? source : "manual_booking";

    // Asegurar cliente.
    const customer = await reservationService.ensureClientExists({
      name: customerDetails.name,
      phoneNumber: customerDetails.phone,
      email: customerDetails.email,
      organizationId,
      birthDate: customerDetails.birthDate,
      documentId: customerDetails.documentId,
      notes: customerDetails.notes,
    });

    // Crear las reservas en pending con hold (cupo retenido hasta expiresAt).
    const groupId = new mongoose.Types.ObjectId();
    const expiresAt = moment().add(HOLD_MINUTES, "minutes").toDate();
    let cursor = moment.tz(startDate, "YYYY-MM-DDTHH:mm:ss", timezone).toDate();

    for (let i = 0; i < services.length; i++) {
      const item = services[i];
      const share = deposit.breakdown[i]?.deposit || 0;
      await reservationService.createReservation({
        serviceId: item.serviceId,
        employeeId: item.employeeId || null,
        startDate: new Date(cursor),
        customer: customer._id,
        customerDetails,
        organizationId,
        status: "pending",
        groupId,
        source: bookingSource,
        paymentStatus: "pending",
        depositAmount: share,
      });
      cursor = new Date(cursor.getTime() + Number(withPrice[i].duration || 0) * 60000);
    }

    // Crear el Order y la preference de MP a nombre del vendedor.
    const order = await orderService.createReservationOrder({
      organizationId,
      groupId,
      amount: deposit.total,
      currency: deposit.currency,
      marketplaceFee: 0,
      expiresAt,
    });

    const pref = await buildAndAttachCheckout({
      org,
      order,
      title: `Depósito de reserva — ${org.name}`,
      expiresAt,
    });

    await Reservation.updateMany({ groupId }, { orderId: order._id });

    return sendResponse(
      res,
      201,
      {
        checkoutUrl: pref.checkoutUrl,
        orderId: String(order._id),
        externalReference: order.externalReference,
        amount: deposit.total,
        currency: deposit.currency,
      },
      "Checkout de depósito creado."
    );
  } catch (err) {
    console.error("[createReservationCheckout]", err.response?.data || err.message);
    const msg = err.response?.data?.message || err.message || "No se pudo crear el checkout.";
    return sendResponse(res, 400, null, msg);
  }
};

// POST /enrollments/checkout  → { checkoutUrl, orderId, externalReference, amount, currency }
// Pay-to-confirm para inscripción a CLASE: retiene el cupo, crea inscripción(es)
// en pending_payment, calcula el depósito (config propia de clases), crea la
// preference de MP y devuelve el checkout. La confirmación la da el webhook.
export const createClassCheckout = async (req, res) => {
  const { sessionId, attendee, companion, notes, organizationId } = req.body;

  if (!sessionId || !attendee?.name || !organizationId) {
    return sendResponse(res, 400, null, "Datos incompletos para el checkout de clase.");
  }

  try {
    const org = await Organization.findById(organizationId);
    if (!org) return sendResponse(res, 404, null, "Organización no encontrada.");
    if (!org.mpCollect?.connected) {
      return sendResponse(res, 400, null, "La organización no tiene Mercado Pago conectado.");
    }

    // Retener cupo + crear inscripciones en pending_payment.
    const hold = await enrollmentService.holdEnrollmentsForPayment({
      organizationId,
      sessionId,
      attendee,
      companion,
      notes,
    });

    // Calcular el depósito con la config PROPIA de clases.
    const deposit = orderService.computeClassDeposit(org, hold.totalPriceSum);
    if (!deposit.required || deposit.total <= 0) {
      // No exige depósito → liberar el hold; el caller debe usar el flujo normal.
      await enrollmentService.releaseEnrollmentHold(hold.groupId);
      return sendResponse(res, 400, null, "La organización no exige depósito para clases o el monto es 0.");
    }

    const expiresAt = moment().add(HOLD_MINUTES, "minutes").toDate();
    const order = await orderService.createClassOrder({
      organizationId,
      groupId: hold.groupId,
      amount: deposit.total,
      currency: deposit.currency,
      marketplaceFee: 0,
      expiresAt,
    });

    const pref = await buildAndAttachCheckout({
      org,
      order,
      title: `Depósito de clase — ${hold.classDoc?.name || org.name}`,
      expiresAt,
    });

    // Vincular el Order a las inscripciones del grupo.
    await Enrollment.updateMany({ groupId: hold.groupId }, { orderId: order._id });

    return sendResponse(
      res,
      201,
      {
        checkoutUrl: pref.checkoutUrl,
        orderId: String(order._id),
        externalReference: order.externalReference,
        amount: deposit.total,
        currency: deposit.currency,
      },
      "Checkout de depósito de clase creado."
    );
  } catch (err) {
    console.error("[createClassCheckout]", err.response?.data || err.message);
    const msg = err.response?.data?.message || err.message || "No se pudo crear el checkout.";
    return sendResponse(res, 400, null, msg);
  }
};

// GET /packages/public?org=<orgId>  → paquetes activos para compra pública
export const listPublicPackages = async (req, res) => {
  try {
    const organizationId = req.query.org || req.organization?._id;
    if (!organizationId) return sendResponse(res, 400, null, "Falta la organización.");

    const org = await Organization.findById(organizationId).select("currency mpCollect paymentMethods").lean();
    if (!org) return sendResponse(res, 404, null, "Organización no encontrada.");

    const packages = await ServicePackage.find({ organizationId, isActive: true })
      .populate("services.serviceId", "name duration")
      .populate("classes.classId", "name duration")
      .sort({ price: 1 })
      .lean();

    // Métodos de transferencia para el flujo de comprobante (campos públicos).
    const paymentMethods = (org.paymentMethods || []).map((pm) => ({
      type: pm.type,
      accountName: pm.accountName,
      accountNumber: pm.accountNumber,
      phoneNumber: pm.phoneNumber,
      qrCodeUrl: pm.qrCodeUrl,
      notes: pm.notes,
    }));

    return sendResponse(
      res,
      200,
      {
        currency: String(org.currency || "COP").toUpperCase(),
        mpConnected: !!org.mpCollect?.connected,
        paymentMethods,
        packages,
      },
      "Paquetes disponibles."
    );
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

// POST /packages/checkout  → { checkoutUrl, orderId, externalReference, amount, currency }
// Compra pública de un paquete pagada online: crea/ubica el cliente, crea el
// Order (type package), la preference de MP y devuelve el checkout. El
// ClientPackage se crea cuando el webhook confirma el pago.
export const createPackageCheckout = async (req, res) => {
  const { servicePackageId, customerDetails, organizationId } = req.body;

  if (!servicePackageId || !customerDetails?.name || !customerDetails?.phone || !organizationId) {
    return sendResponse(res, 400, null, "Datos incompletos para la compra del paquete.");
  }

  try {
    const org = await Organization.findById(organizationId);
    if (!org) return sendResponse(res, 404, null, "Organización no encontrada.");
    if (!org.mpCollect?.connected) {
      return sendResponse(res, 400, null, "La organización no tiene Mercado Pago conectado.");
    }

    const pkg = await ServicePackage.findOne({
      _id: servicePackageId,
      organizationId,
      isActive: true,
    });
    if (!pkg) return sendResponse(res, 404, null, "Paquete no encontrado o inactivo.");

    const amount = orderService.roundForCurrency(Number(pkg.price || 0), org.currency);
    if (amount <= 0) return sendResponse(res, 400, null, "El paquete no tiene un precio válido.");

    // Crear/ubicar el cliente comprador.
    const customer = await reservationService.ensureClientExists({
      name: customerDetails.name,
      phoneNumber: customerDetails.phone,
      email: customerDetails.email,
      organizationId,
      birthDate: customerDetails.birthDate,
      documentId: customerDetails.documentId,
      notes: customerDetails.notes,
    });

    const expiresAt = moment().add(HOLD_MINUTES, "minutes").toDate();
    const order = await orderService.createPackageOrder({
      organizationId,
      servicePackageId,
      clientId: customer._id,
      amount,
      currency: String(org.currency || "COP").toUpperCase(),
      marketplaceFee: 0,
      expiresAt,
    });

    const pref = await buildAndAttachCheckout({
      org,
      order,
      title: `Paquete — ${pkg.name}`,
      expiresAt,
    });

    return sendResponse(
      res,
      201,
      {
        checkoutUrl: pref.checkoutUrl,
        orderId: String(order._id),
        externalReference: order.externalReference,
        amount,
        currency: String(org.currency || "COP").toUpperCase(),
      },
      "Checkout de compra de paquete creado."
    );
  } catch (err) {
    console.error("[createPackageCheckout]", err.response?.data || err.message);
    const msg = err.response?.data?.message || err.message || "No se pudo crear el checkout.";
    return sendResponse(res, 400, null, msg);
  }
};

// Secreto de firma del webhook por país (del dashboard de MP).
function webhookSecret(country) {
  const cc = String(country || "CO").toUpperCase();
  return process.env[`MP_${cc}_WEBHOOK_SECRET`];
}

// POST /mp/webhook?org=<orgId>  → notificación de pago de MP
// Valida firma, confirma el pago, marca el Order pagado y aprueba la reserva
// (crea las citas + WhatsApp). Idempotente por payment id.
export const mpWebhook = async (req, res) => {
  // MP espera 200/201 rápido; si fallamos devolvemos 500 y MP reintenta.
  const type = req.query.type || req.body?.type;
  const dataId = req.query["data.id"] || req.body?.data?.id;
  const orgId = req.query.org;

  // Solo nos interesan notificaciones de pago.
  if (type !== "payment" || !dataId) return res.sendStatus(200);

  try {
    if (!orgId) {
      console.warn("[mpWebhook] notificación sin ?org=, no se puede resolver la cuenta.");
      return res.sendStatus(200);
    }

    const org = await Organization.findById(orgId).select("default_country").lean();

    // Validar firma (si hay secreto configurado para el país).
    const secret = webhookSecret(org?.default_country);
    if (secret) {
      const ok = mpProvider.verifySignature({
        xSignature: req.headers["x-signature"],
        xRequestId: req.headers["x-request-id"],
        dataId,
        secret,
      });
      if (!ok) {
        console.warn("[mpWebhook] firma inválida — descartando.");
        return res.sendStatus(401);
      }
    } else {
      console.warn(`[mpWebhook] sin MP_${(org?.default_country || "CO").toUpperCase()}_WEBHOOK_SECRET; se omite validación de firma (solo dev).`);
    }

    // Consultar el pago con el token del vendedor.
    const { accessToken } = await mpConnect.getSellerToken(orgId);
    const payment = await mpProvider.getPayment(dataId, accessToken);

    const externalReference = payment?.external_reference;
    if (!externalReference) {
      console.warn("[mpWebhook] pago sin external_reference.");
      return res.sendStatus(200);
    }

    const order = await Order.findOne({ externalReference });
    if (!order) {
      console.warn(`[mpWebhook] Order no encontrado para ref ${externalReference}.`);
      return res.sendStatus(200);
    }

    // Solo confirmamos en approved. Otros estados: registrar y salir.
    if (payment.status !== "approved") {
      if (payment.status === "rejected" || payment.status === "cancelled") {
        await orderService.setOrderStatus(order._id, "failed");
      }
      return res.sendStatus(200);
    }

    // Idempotencia: si ya procesamos este pago, salir.
    if (order.processedEventIds?.includes(String(dataId))) {
      return res.sendStatus(200);
    }

    // Cumplir la orden según su tipo (reserva / clase / paquete).
    await fulfillOrder(order);

    // Marcar el Order pagado (idempotente).
    await orderService.markOrderPaid(order._id, {
      paymentId: dataId,
      eventId: String(dataId),
      raw: payment,
    });

    return res.sendStatus(200);
  } catch (err) {
    console.error("[mpWebhook]", err.response?.data || err.message);
    // 500 → MP reintenta; la idempotencia evita doble-procesamiento.
    return res.sendStatus(500);
  }
};

// GET /mp/order/:externalReference  → { status, paymentStatus, amount, currency }
// Público: la pantalla de retorno hace polling hasta que el webhook confirma.
export const getOrderStatus = async (req, res) => {
  try {
    const order = await Order.findOne({ externalReference: req.params.externalReference })
      .select("status amount currency refId type")
      .lean();
    if (!order) return sendResponse(res, 404, null, "Orden no encontrada.");

    return sendResponse(
      res,
      200,
      {
        status: order.status, // created | pending | paid | failed | expired | refunded
        amount: order.amount,
        currency: order.currency,
        type: order.type,
      },
      "Estado de la orden."
    );
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

// GET /organizations/:id/mp/status  → { connected, userId, site, ... }
export const mpStatus = async (req, res) => {
  try {
    const status = await mpConnect.getStatus(req.params.id);
    return sendResponse(res, 200, status, "Estado de Mercado Pago.");
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

// POST /organizations/:id/mp/disconnect
export const mpDisconnect = async (req, res) => {
  try {
    await mpConnect.disconnect(req.params.id);
    return sendResponse(res, 200, null, "Mercado Pago desconectado.");
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};
