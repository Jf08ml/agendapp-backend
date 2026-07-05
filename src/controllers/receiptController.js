/**
 * receiptController.js
 *
 * Cobro cliente→org por TRANSFERENCIA MANUAL con validación de comprobante por IA.
 * Es el segundo proveedor de cobro junto a Mercado Pago: reusa el modelo `Order`
 * y `fulfillOrder` (cumplimiento idéntico), pero en vez de un checkout hospedado,
 * el cliente sube la foto del comprobante y un modelo Claude con visión la valida.
 *
 * Flujo:
 *  1. createReceipt*Checkout → crea el Order (provider "receipt") + hold + datos
 *     bancarios a mostrar. NO crea las citas/inscripciones (eso ocurre al pagar).
 *  2. submitReceipt (público) → sube la imagen, la IA extrae+valida. Si hay match
 *     alto → auto-confirma (fulfillOrder + paid). Si no → in_review (espera admin).
 *     En ambos casos notifica al admin (push + in-app + WhatsApp).
 *  3. listReceiptOrders / reviewReceiptOrder (admin) → bandeja de revisión.
 */

import mongoose from "mongoose";
import moment from "moment-timezone";
import sendResponse from "../utils/sendResponse.js";
import imagekit from "../config/imageKit.js";
import * as orderService from "../services/collection/orderService.js";
import * as receiptValidation from "../services/collection/receiptValidationService.js";
import { fulfillOrder, releaseOrderHold } from "../services/collection/fulfillmentService.js";
import { notifyAdminReceipt } from "../services/collection/adminPaymentNotifier.js";
import reservationService from "../services/reservationService.js";
import enrollmentService from "../services/enrollmentService.js";
import Organization from "../models/organizationModel.js";
import Service from "../models/serviceModel.js";
import Reservation from "../models/reservationModel.js";
import Enrollment from "../models/enrollmentModel.js";
import ServicePackage from "../models/servicePackageModel.js";
import Order from "../models/orderModel.js";

// El cliente necesita tiempo para transferir y subir el comprobante.
const HOLD_MINUTES = 60;

const MIME_OK = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
// Máximo de comprobantes que se pueden subir por orden (cada uno llama a la IA).
const MAX_RECEIPT_ATTEMPTS = 5;

/**
 * Libera holds de reserva abandonados de un cliente: Orders de comprobante en
 * estado "created" (nunca se subió imagen) cuyas reservas siguen pendientes. Se
 * marcan expired y sus reservas rejected, para no acumular pendientes al
 * reintentar el checkout. Best-effort (no rompe el flujo si falla).
 */
async function releaseAbandonedReceiptHolds(organizationId, customerId) {
  try {
    const pending = await Reservation.find({
      organizationId,
      customer: customerId,
      status: "pending",
      paymentStatus: "pending",
      orderId: { $ne: null },
    })
      .select("orderId")
      .lean();
    const orderIds = [...new Set(pending.map((r) => String(r.orderId)))];
    if (orderIds.length === 0) return;

    const abandoned = await Order.find({
      _id: { $in: orderIds },
      provider: "receipt",
      status: "created",
      "receipt.imageUrl": { $exists: false },
    })
      .select("_id")
      .lean();

    for (const o of abandoned) {
      await Order.updateOne({ _id: o._id }, { status: "expired" });
      await Reservation.updateMany(
        { orderId: o._id, status: "pending" },
        { status: "rejected", errorMessage: "Reemplazada por un nuevo intento de reserva." }
      );
    }
  } catch (err) {
    console.warn("[releaseAbandonedReceiptHolds]", err?.message || err);
  }
}

/** Métodos de pago "manuales" (transferencia) configurados por la org, para mostrar al cliente.
 *  Exportada: la reusa la tienda pública (storeController: catálogo + checkout por comprobante). */
export function publicPaymentMethods(org) {
  return (org.paymentMethods || []).map((pm) => ({
    type: pm.type,
    accountName: pm.accountName,
    accountNumber: pm.accountNumber,
    phoneNumber: pm.phoneNumber,
    qrCodeUrl: pm.qrCodeUrl,
    notes: pm.notes,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) CHECKOUTS MANUALES (crean el Order + hold; devuelven datos bancarios)
// ─────────────────────────────────────────────────────────────────────────────

// POST /collection/receipt/reservation
export const createReceiptReservationCheckout = async (req, res) => {
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
    if (!(org.paymentMethods || []).length) {
      return sendResponse(res, 400, null, "La organización no tiene métodos de pago configurados.");
    }

    const serviceIds = services.map((s) => s.serviceId);
    const docs = await Service.find({ _id: { $in: serviceIds } }).lean();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    const withPrice = services.map((s) => {
      const doc = byId.get(String(s.serviceId));
      if (!doc) throw new Error("Servicio no encontrado.");
      return { _id: doc._id, price: Number(doc.price || 0), duration: s.duration || doc.duration || 0 };
    });

    const deposit = orderService.computeDepositForServices(org, withPrice);
    if (!deposit.required || deposit.total <= 0) {
      return sendResponse(res, 400, null, "La organización no exige depósito o el monto es 0.");
    }

    const timezone = org.timezone || "America/Bogota";
    const bookingSource = ["ai_chatbot", "manual_booking", "admin"].includes(source) ? source : "manual_booking";

    const customer = await reservationService.ensureClientExists({
      name: customerDetails.name,
      phoneNumber: customerDetails.phone,
      email: customerDetails.email,
      organizationId,
      birthDate: customerDetails.birthDate,
      documentId: customerDetails.documentId,
      notes: customerDetails.notes,
    });

    // #6 Liberar holds ABANDONADOS del mismo cliente (intentos previos donde se
    // creó la reserva pero nunca se subió comprobante) para no acumular pendientes.
    await releaseAbandonedReceiptHolds(organizationId, customer._id);

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

    const order = await orderService.createReservationOrder({
      organizationId,
      groupId,
      amount: deposit.total,
      currency: deposit.currency,
      provider: "receipt",
      expiresAt,
    });
    await Reservation.updateMany({ groupId }, { orderId: order._id });

    return sendResponse(
      res,
      201,
      {
        orderId: String(order._id),
        externalReference: order.externalReference,
        amount: deposit.total,
        currency: deposit.currency,
        paymentMethods: publicPaymentMethods(org),
      },
      "Checkout manual de reserva creado."
    );
  } catch (err) {
    console.error("[createReceiptReservationCheckout]", err.message);
    return sendResponse(res, 400, null, err.message || "No se pudo crear el checkout.");
  }
};

// POST /collection/receipt/class
export const createReceiptClassCheckout = async (req, res) => {
  const { sessionId, attendee, companion, notes, organizationId } = req.body;

  if (!sessionId || !attendee?.name || !organizationId) {
    return sendResponse(res, 400, null, "Datos incompletos para el checkout de clase.");
  }

  try {
    const org = await Organization.findById(organizationId);
    if (!org) return sendResponse(res, 404, null, "Organización no encontrada.");
    if (!(org.paymentMethods || []).length) {
      return sendResponse(res, 400, null, "La organización no tiene métodos de pago configurados.");
    }

    const hold = await enrollmentService.holdEnrollmentsForPayment({
      organizationId,
      sessionId,
      attendee,
      companion,
      notes,
    });

    const deposit = orderService.computeClassDeposit(org, hold.totalPriceSum);
    if (!deposit.required || deposit.total <= 0) {
      await enrollmentService.releaseEnrollmentHold(hold.groupId);
      return sendResponse(res, 400, null, "La organización no exige depósito para clases o el monto es 0.");
    }

    const expiresAt = moment().add(HOLD_MINUTES, "minutes").toDate();
    const order = await orderService.createClassOrder({
      organizationId,
      groupId: hold.groupId,
      amount: deposit.total,
      currency: deposit.currency,
      provider: "receipt",
      expiresAt,
    });
    await Enrollment.updateMany({ groupId: hold.groupId }, { orderId: order._id });

    return sendResponse(
      res,
      201,
      {
        orderId: String(order._id),
        externalReference: order.externalReference,
        amount: deposit.total,
        currency: deposit.currency,
        paymentMethods: publicPaymentMethods(org),
      },
      "Checkout manual de clase creado."
    );
  } catch (err) {
    console.error("[createReceiptClassCheckout]", err.message);
    return sendResponse(res, 400, null, err.message || "No se pudo crear el checkout.");
  }
};

// POST /collection/receipt/package
export const createReceiptPackageCheckout = async (req, res) => {
  const { servicePackageId, customerDetails, organizationId } = req.body;

  if (!servicePackageId || !customerDetails?.name || !customerDetails?.phone || !organizationId) {
    return sendResponse(res, 400, null, "Datos incompletos para la compra del paquete.");
  }

  try {
    const org = await Organization.findById(organizationId);
    if (!org) return sendResponse(res, 404, null, "Organización no encontrada.");
    if (!(org.paymentMethods || []).length) {
      return sendResponse(res, 400, null, "La organización no tiene métodos de pago configurados.");
    }

    const pkg = await ServicePackage.findOne({ _id: servicePackageId, organizationId, isActive: true });
    if (!pkg) return sendResponse(res, 404, null, "Paquete no encontrado o inactivo.");

    const amount = orderService.roundForCurrency(Number(pkg.price || 0), org.currency);
    if (amount <= 0) return sendResponse(res, 400, null, "El paquete no tiene un precio válido.");

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
      provider: "receipt",
      expiresAt,
    });

    return sendResponse(
      res,
      201,
      {
        orderId: String(order._id),
        externalReference: order.externalReference,
        amount,
        currency: String(org.currency || "COP").toUpperCase(),
        paymentMethods: publicPaymentMethods(org),
      },
      "Checkout manual de paquete creado."
    );
  } catch (err) {
    console.error("[createReceiptPackageCheckout]", err.message);
    return sendResponse(res, 400, null, err.message || "No se pudo crear el checkout.");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2) SUBIDA DEL COMPROBANTE (público) → IA valida → auto-confirma o in_review
// ─────────────────────────────────────────────────────────────────────────────

// POST /collection/receipt/:externalReference  (multipart: campo "image")
export const submitReceipt = async (req, res) => {
  try {
    const { externalReference } = req.params;
    if (!req.file?.buffer) return sendResponse(res, 400, null, "Debe adjuntar la imagen del comprobante.");
    if (!MIME_OK.has(req.file.mimetype)) {
      return sendResponse(res, 400, null, "Formato no soportado (use JPG, PNG o WEBP).");
    }
    if (req.file.size > MAX_BYTES) return sendResponse(res, 400, null, "La imagen supera el tamaño máximo (8MB).");

    const order = await Order.findOne({ externalReference });
    if (!order) return sendResponse(res, 404, null, "Orden no encontrada.");
    if (order.provider !== "receipt") {
      return sendResponse(res, 400, null, "Esta orden no admite comprobante.");
    }
    if (["paid", "expired", "refunded"].includes(order.status)) {
      return sendResponse(res, 409, null, "Esta orden ya no admite comprobantes.");
    }

    // Anti-abuso: tope de intentos (cada subida llama a la IA, que cuesta).
    if ((order.receiptAttempts || 0) >= MAX_RECEIPT_ATTEMPTS) {
      return sendResponse(res, 429, null, "Demasiados intentos. Comunícate con el negocio.");
    }
    // Reservar el intento de forma atómica antes de llamar a la IA.
    await Order.updateOne({ _id: order._id }, { $inc: { receiptAttempts: 1 } });

    const org = await Organization.findById(order.organizationId);
    if (!org) return sendResponse(res, 404, null, "Organización no encontrada.");

    // Subir a ImageKit.
    const uploaded = await imagekit.upload({
      file: req.file.buffer.toString("base64"),
      fileName: `receipt_${externalReference}_${Date.now()}.${req.file.mimetype.split("/")[1]}`,
      folder: `/receipts/${order.organizationId}`,
    });

    // Extraer datos con IA (visión).
    const extracted = await receiptValidation.extractReceiptData({
      imageBase64: req.file.buffer.toString("base64"),
      mimeType: req.file.mimetype,
      expected: { amount: order.amount, currency: order.currency },
    });

    // Anti-duplicado: ¿la referencia ya se usó en un pago confirmado de esta org?
    let isDuplicateReference = false;
    if (extracted.reference) {
      const dup = await Order.findOne({
        organizationId: order.organizationId,
        "receipt.extracted.reference": extracted.reference,
        status: "paid",
        _id: { $ne: order._id },
      }).select("_id").lean();
      isDuplicateReference = !!dup;
    }

    const decision = receiptValidation.evaluateReceipt({
      extracted,
      expectedAmount: order.amount,
      currency: order.currency,
      paymentMethods: org.paymentMethods,
      isDuplicateReference,
    });

    // Comprobante a persistir (se escribe con updateOne para no pisar el status
    // que pueda haber cambiado en una subida concurrente).
    const receiptDoc = {
      imageUrl: uploaded.url,
      imageFileId: uploaded.fileId,
      uploadedAt: new Date(),
      extracted: {
        amount: extracted.amount,
        currency: extracted.currency,
        date: extracted.date,
        reference: extracted.reference,
        destinationAccount: extracted.destinationAccount,
        bank: extracted.bank,
        senderName: extracted.senderName,
      },
      aiConfidence: extracted.confidence,
      aiVerdict: decision.verdict,
      aiNotes: [extracted.notes, ...decision.reasons].filter(Boolean).join(" "),
    };

    if (decision.autoApprove) {
      // Claim atómico: solo un proceso pasa de no-pagado → paid (evita doble
      // cumplimiento por subidas concurrentes).
      const claimed = await Order.findOneAndUpdate(
        { _id: order._id, status: { $in: ["created", "pending", "in_review"] } },
        {
          $set: {
            receipt: { ...receiptDoc, reviewStatus: "auto_approved" },
            status: "paid",
            paidAt: new Date(),
          },
        },
        { new: true }
      );
      if (!claimed) {
        // Otra subida ya la procesó.
        return sendResponse(res, 200, { status: "paid", autoApproved: true, externalReference }, "Pago ya confirmado.");
      }
      try {
        await fulfillOrder(claimed);
      } catch (e) {
        // Revertir el claim si el cumplimiento falla, para no dejarla "paid" sin citas.
        await Order.updateOne(
          { _id: order._id },
          { $set: { status: "in_review", "receipt.reviewStatus": "pending_review" }, $unset: { paidAt: 1 } }
        );
        throw e;
      }
      notifyAdminReceipt({ org, order: claimed, autoApproved: true }).catch((err) =>
        console.warn("[submitReceipt] notify falló:", err?.message || err)
      );
      return sendResponse(
        res,
        200,
        { status: "paid", autoApproved: true, externalReference },
        "¡Pago confirmado! Tu reserva quedó lista."
      );
    }

    // No auto-aprobado → in_review.
    await Order.updateOne(
      { _id: order._id, status: { $in: ["created", "pending", "in_review"] } },
      { $set: { receipt: { ...receiptDoc, reviewStatus: "pending_review" }, status: "in_review" } }
    );
    notifyAdminReceipt({
      org,
      order: { type: order.type, amount: order.amount, currency: order.currency, receipt: receiptDoc },
      autoApproved: false,
    }).catch((err) => console.warn("[submitReceipt] notify falló:", err?.message || err));

    return sendResponse(
      res,
      200,
      { status: "in_review", autoApproved: false, externalReference },
      "Recibimos tu comprobante. Lo estamos validando y te confirmaremos pronto."
    );
  } catch (err) {
    console.error("[submitReceipt]", err.response?.data || err.message);
    return sendResponse(res, 400, null, err.message || "No se pudo procesar el comprobante.");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3) BANDEJA DE REVISIÓN (admin)
// ─────────────────────────────────────────────────────────────────────────────

// GET /collection/receipts?status=in_review   (admin)
export const listReceiptOrders = async (req, res) => {
  try {
    const organizationId = req.organization?._id;
    const status = req.query.status || "in_review";

    // "all" → todos los comprobantes (subidos), sin filtrar por estado. Excluye
    // las órdenes que nunca recibieron comprobante (holds "created" sin imagen).
    const filter = { organizationId, provider: "receipt" };
    if (status === "all") {
      filter["receipt.imageUrl"] = { $exists: true };
    } else {
      filter.status = status;
    }

    const orders = await Order.find(filter)
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();

    return sendResponse(res, 200, { orders }, "Comprobantes.");
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

// POST /collection/receipts/:id/review   { decision: "approve" | "reject", notes }  (admin)
export const reviewReceiptOrder = async (req, res) => {
  try {
    const { decision, notes } = req.body;
    if (!["approve", "reject"].includes(decision)) {
      return sendResponse(res, 400, null, "Decisión inválida (approve | reject).");
    }

    const reviewer = req.user?.name || req.user?.email || "Admin";
    const newStatus = decision === "approve" ? "paid" : "failed";
    const reviewStatus = decision === "approve" ? "approved" : "rejected";

    // Claim atómico: solo un revisor pasa el comprobante de in_review → estado
    // final (evita doble cumplimiento por aprobaciones concurrentes).
    const order = await Order.findOneAndUpdate(
      {
        _id: req.params.id,
        organizationId: req.organization?._id,
        provider: "receipt",
        status: "in_review",
      },
      {
        $set: {
          status: newStatus,
          ...(decision === "approve" ? { paidAt: new Date() } : {}),
          "receipt.reviewStatus": reviewStatus,
          "receipt.reviewedBy": reviewer,
          "receipt.reviewedAt": new Date(),
          ...(notes ? { "receipt.reviewNotes": notes } : {}),
        },
      },
      { new: true }
    );
    if (!order) {
      return sendResponse(res, 409, null, "Este comprobante ya fue procesado.");
    }

    try {
      if (decision === "approve") {
        await fulfillOrder(order);
      } else {
        await releaseOrderHold(order, "El comprobante de pago fue rechazado por el negocio.");
      }
    } catch (e) {
      // Revertir el claim si falla el cumplimiento/liberación.
      await Order.updateOne(
        { _id: order._id },
        { $set: { status: "in_review", "receipt.reviewStatus": "pending_review" }, $unset: { paidAt: 1 } }
      );
      throw e;
    }

    return sendResponse(res, 200, { status: order.status }, decision === "approve" ? "Pago aprobado." : "Comprobante rechazado.");
  } catch (err) {
    console.error("[reviewReceiptOrder]", err.message);
    return sendResponse(res, 400, null, err.message);
  }
};
