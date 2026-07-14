/**
 * storeController.js
 *
 * Tienda pública de productos (Order type "store").
 *
 * Público (routes/storePublicRoutes.js, Grupo 1 sin auth):
 *  - GET  /store/catalog   → catálogo (solo campos públicos) + vías de pago disponibles.
 *  - POST /store/checkout  → pago online con Mercado Pago (copia createPackageCheckout).
 *  - POST /store/cod       → pedido contraentrega (nace "pending", sin descontar stock).
 *  - POST /collection/receipt/store → pago por transferencia + comprobante
 *    (montado en receiptPublicRoutes.js; copia createReceiptPackageCheckout).
 *
 * Admin (routes/storeAdminRoutes.js, Grupo 4: resolver + auth + membership):
 *  - GET  /store-orders                → bandeja de pedidos.
 *  - POST /store-orders/:id/deliver    → marcar entregado (pedidos pagados online).
 *  - POST /store-orders/:id/collect    → COD: registrar cobro (crea ProductSale) + entregar.
 *  - POST /store-orders/:id/cancel     → cancelar (solo pedidos no pagados).
 *
 * Momento del stock (decisiones 2 y 3 del plan): al crear el pedido solo se
 * VALIDA stock (chequeo simple, no atómico). El descuento real + ProductSale
 * ocurren al confirmarse el pago (fulfillStoreOrder) o al cobrar contraentrega
 * (collect), siempre vía productService.createSale (descuento atómico).
 */

import sendResponse from "../utils/sendResponse.js";
import Organization from "../models/organizationModel.js";
import Product from "../models/productModel.js";
import Order from "../models/orderModel.js";
import productService from "../services/productService.js";
import * as orderService from "../services/collection/orderService.js";
import { buildAndAttachCheckout } from "./collectionController.js";
import { publicPaymentMethods } from "./receiptController.js";
import { notifyNewStoreOrder, notifyStorePaymentReceived } from "../services/collection/storeNotifier.js";

const COD_METHODS = ["cash", "card", "transfer", "other"];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de validación (compartidos por los 3 checkouts)
// ─────────────────────────────────────────────────────────────────────────────

// Config por defecto cuando la organización no tiene storeFormConfig.fields
// configurado (equivalente a DEFAULT_STORE_FORM_CONFIG del frontend): mismo
// comportamiento que existía antes de que el formulario fuera configurable.
const DEFAULT_STORE_FORM_FIELDS = [
  { key: "name", enabled: true, required: true },
  { key: "phone", enabled: true, required: true },
  { key: "email", enabled: true, required: false },
  { key: "documentId", enabled: false, required: false },
];

/**
 * Valida y normaliza el snapshot del comprador + la modalidad de entrega,
 * según el `storeFormConfig` de la organización (independiente del
 * `clientFormConfig` usado para citas — la tienda es para público general).
 */
function validateCustomerAndDelivery(customer, delivery, org) {
  const storeFormConfig = org?.storeFormConfig;
  const identifierField = storeFormConfig?.identifierField || "phone";
  const fields = storeFormConfig?.fields?.length ? storeFormConfig.fields : DEFAULT_STORE_FORM_FIELDS;
  const fieldCfg = (key) => fields.find((f) => f.key === key) ?? { key, enabled: false, required: false };

  if (!customer?.name?.trim()) {
    throw new Error("Falta el nombre del comprador.");
  }
  // El teléfono siempre es obligatorio: el negocio necesita poder contactar al comprador.
  if (!customer?.phone?.trim()) {
    throw new Error("Falta el teléfono del comprador.");
  }
  const emailRequired = fieldCfg("email").required || identifierField === "email";
  if (emailRequired && !customer?.email?.trim()) {
    throw new Error("El correo electrónico es obligatorio.");
  }
  const documentIdRequired = fieldCfg("documentId").required || identifierField === "documentId";
  if (documentIdRequired && !customer?.documentId?.trim()) {
    throw new Error("El número de documento es obligatorio.");
  }

  const mode = delivery?.mode;
  if (!["pickup", "delivery"].includes(mode)) {
    throw new Error("Modalidad de entrega inválida (pickup | delivery).");
  }
  if (mode === "delivery" && !String(delivery?.address || "").trim()) {
    throw new Error("La dirección es obligatoria para entregas a domicilio.");
  }

  const lat = Number(delivery?.lat);
  const lng = Number(delivery?.lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

  return {
    customer: {
      name: String(customer.name).trim(),
      phone: String(customer.phone).trim(),
      email: customer.email ? String(customer.email).trim() : "",
      documentId: customer.documentId ? String(customer.documentId).trim() : "",
    },
    delivery: {
      mode,
      address: String(delivery?.address || "").trim(),
      notes: String(delivery?.notes || "").trim(),
      ...(hasCoords ? { lat, lng } : {}),
    },
  };
}

/**
 * Valida los items contra el catálogo (activos + visibles en tienda) y el stock
 * (chequeo simple, NO atómico — suficiente para UX; el descuento real es atómico
 * al pagar). Devuelve snapshots con el precio del Product (nunca del cliente) y
 * el total redondeado según la moneda.
 */
async function validateStoreItems(org, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("El pedido debe incluir al menos un producto.");
  }

  const products = await Product.find({
    _id: { $in: items.map((i) => i.productId) },
    organizationId: org._id,
    active: true,
    visibleInStore: true,
  });
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const normalized = items.map((item) => {
    const product = byId.get(String(item.productId));
    if (!product) throw new Error("Producto no encontrado o no disponible en la tienda.");
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error(`Cantidad inválida para ${product.name}.`);
    }
    if (product.trackStock && product.stockQuantity < quantity) {
      throw new Error(`Stock insuficiente para ${product.name}.`);
    }
    return {
      productId: product._id,
      name: product.name,
      quantity,
      unitPrice: Number(product.salePrice || 0),
    };
  });

  const amount = orderService.roundForCurrency(
    normalized.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0),
    org.currency
  );
  if (!(amount > 0)) throw new Error("El pedido no tiene un monto válido.");

  return { items: normalized, amount };
}

/** Carga la org (por body u organizationResolver) y exige la tienda activa. */
async function loadStoreOrg(organizationId) {
  if (!organizationId) throw new Error("Falta la organización.");
  const org = await Organization.findById(organizationId);
  if (!org) {
    const err = new Error("Organización no encontrada.");
    err.statusCode = 404;
    throw err;
  }
  if (!org.storeEnabled) {
    const err = new Error("La tienda no está disponible.");
    err.statusCode = 403;
    throw err;
  }
  return org;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) PÚBLICO — catálogo y checkouts
// ─────────────────────────────────────────────────────────────────────────────

// GET /store/catalog  (organizationResolver; acepta ?org= como fallback)
// ⚠️ Respuesta pública: SOLO campos listados en el plan. Jamás exponer
// costPrice, commissionType/commissionValue, stockQuantity exacto ni lowStock*.
export const getStoreCatalog = async (req, res) => {
  try {
    const organizationId = req.query.org || req.organization?._id;
    if (!organizationId) return sendResponse(res, 400, null, "Falta la organización.");

    const org = await Organization.findById(organizationId)
      .select("currency mpCollect paymentMethods storeEnabled storeCodEnabled")
      .lean();
    if (!org) return sendResponse(res, 404, null, "Organización no encontrada.");
    if (!org.storeEnabled) return sendResponse(res, 403, null, "La tienda no está disponible.");

    const docs = await Product.find({
      organizationId,
      active: true,
      visibleInStore: true,
    })
      .select("name brand category description imageUrl salePrice trackStock stockQuantity")
      .sort({ name: 1 })
      .lean();

    // Campos públicos: el stock exacto NO se expone, solo "agotado".
    const products = docs.map((p) => ({
      _id: p._id,
      name: p.name,
      brand: p.brand,
      category: p.category,
      description: p.description,
      imageUrl: p.imageUrl || "",
      salePrice: p.salePrice,
      outOfStock: !!(p.trackStock && p.stockQuantity <= 0),
    }));

    return sendResponse(
      res,
      200,
      {
        currency: String(org.currency || "COP").toUpperCase(),
        mpConnected: !!org.mpCollect?.connected,
        paymentMethods: publicPaymentMethods(org),
        // Legacy docs sin el campo (lean no aplica defaults) → default true.
        codEnabled: org.storeCodEnabled !== false,
        products,
      },
      "Catálogo de la tienda."
    );
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

// POST /store/checkout  → { checkoutUrl, orderId, externalReference, amount, currency }
// Pago online con Mercado Pago (copia createPackageCheckout). El stock se valida
// aquí (simple) y se descuenta cuando el webhook confirma el pago (fulfillStoreOrder).
export const createStoreCheckout = async (req, res) => {
  const { items, customer, delivery, organizationId } = req.body;

  try {
    const org = await loadStoreOrg(organizationId);
    if (!org.mpCollect?.connected) {
      return sendResponse(res, 400, null, "La organización no tiene Mercado Pago conectado.");
    }

    const buyer = validateCustomerAndDelivery(customer, delivery, org);
    const validated = await validateStoreItems(org, items);

    const order = await orderService.createStoreOrder({
      organizationId: org._id,
      items: validated.items,
      customer: buyer.customer,
      delivery: buyer.delivery,
      amount: validated.amount,
      currency: String(org.currency || "COP").toUpperCase(),
      marketplaceFee: 0,
      provider: "mercadopago",
    });

    const pref = await buildAndAttachCheckout({
      org,
      order,
      title: `Pedido en ${org.name}`,
      expiresAt: null, // sin hold de stock → la preference no expira
    });

    return sendResponse(
      res,
      201,
      {
        checkoutUrl: pref.checkoutUrl,
        orderId: String(order._id),
        externalReference: order.externalReference,
        amount: validated.amount,
        currency: String(org.currency || "COP").toUpperCase(),
      },
      "Checkout del pedido creado."
    );
  } catch (err) {
    console.error("[createStoreCheckout]", err.response?.data || err.message);
    const msg = err.response?.data?.message || err.message || "No se pudo crear el checkout.";
    return sendResponse(res, err.statusCode || 400, null, msg);
  }
};

// POST /store/cod  → { orderId, externalReference, amount, currency }
// Contraentrega: el pedido nace "pending" y NO descuenta stock (decisión 3).
// El admin registra el cobro al entregar (POST /store-orders/:id/collect).
export const createStoreCodOrder = async (req, res) => {
  const { items, customer, delivery, organizationId } = req.body;

  try {
    const org = await loadStoreOrg(organizationId);
    if (org.storeCodEnabled === false) {
      return sendResponse(res, 400, null, "La organización no acepta pago contraentrega.");
    }

    const buyer = validateCustomerAndDelivery(customer, delivery, org);
    const validated = await validateStoreItems(org, items);

    const order = await orderService.createStoreOrder({
      organizationId: org._id,
      items: validated.items,
      customer: buyer.customer,
      delivery: buyer.delivery,
      amount: validated.amount,
      currency: String(org.currency || "COP").toUpperCase(),
      provider: "cod",
      status: "pending",
    });

    // Notificar al admin de inmediato (COD no pasa por fulfillOrder al crear).
    notifyNewStoreOrder({ org, order }).catch((e) =>
      console.warn("[createStoreCodOrder] notifyNewStoreOrder falló:", e?.message || e)
    );

    return sendResponse(
      res,
      201,
      {
        orderId: String(order._id),
        externalReference: order.externalReference,
        amount: validated.amount,
        currency: String(org.currency || "COP").toUpperCase(),
      },
      "Pedido recibido. Pagarás al recibirlo."
    );
  } catch (err) {
    console.error("[createStoreCodOrder]", err.message);
    return sendResponse(res, err.statusCode || 400, null, err.message || "No se pudo crear el pedido.");
  }
};

// POST /collection/receipt/store  → { orderId, externalReference, amount, currency, paymentMethods }
// Transferencia + comprobante con IA (copia createReceiptPackageCheckout). La
// subida del comprobante y el polling reusan /collection/receipt/:externalReference
// y /collection/order/:externalReference sin cambios.
export const createReceiptStoreCheckout = async (req, res) => {
  const { items, customer, delivery, organizationId } = req.body;

  try {
    const org = await loadStoreOrg(organizationId);
    if (!(org.paymentMethods || []).length) {
      return sendResponse(res, 400, null, "La organización no tiene métodos de pago configurados.");
    }

    const buyer = validateCustomerAndDelivery(customer, delivery, org);
    const validated = await validateStoreItems(org, items);

    const order = await orderService.createStoreOrder({
      organizationId: org._id,
      items: validated.items,
      customer: buyer.customer,
      delivery: buyer.delivery,
      amount: validated.amount,
      currency: String(org.currency || "COP").toUpperCase(),
      provider: "receipt",
    });

    return sendResponse(
      res,
      201,
      {
        orderId: String(order._id),
        externalReference: order.externalReference,
        amount: validated.amount,
        currency: String(org.currency || "COP").toUpperCase(),
        paymentMethods: publicPaymentMethods(org),
      },
      "Checkout manual del pedido creado."
    );
  } catch (err) {
    console.error("[createReceiptStoreCheckout]", err.message);
    return sendResponse(res, err.statusCode || 400, null, err.message || "No se pudo crear el checkout.");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2) ADMIN — bandeja de pedidos (/store-orders)
// ─────────────────────────────────────────────────────────────────────────────

// GET /store-orders?fulfillment=pending|delivered|cancelled|all  → { orders }
export const listStoreOrders = async (req, res) => {
  try {
    const organizationId = req.organization?._id;
    if (!organizationId) return sendResponse(res, 400, null, "Organización no identificada.");

    const fulfillment = req.query.fulfillment || "pending";
    const filter = { organizationId, type: "store" };
    if (fulfillment !== "all") {
      filter["store.fulfillmentStatus"] = ["pending", "delivered", "cancelled"].includes(fulfillment)
        ? fulfillment
        : "pending";
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    return sendResponse(res, 200, { orders }, "Pedidos de la tienda.");
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

// POST /store-orders/:id/deliver  → { order }
// Pedidos PAGADOS online: solo marca la entrega (la venta ya se registró al pagar).
export const deliverStoreOrder = async (req, res) => {
  try {
    const organizationId = req.organization?._id;

    // Claim atómico: solo un admin pasa el pedido de pending → delivered.
    const order = await Order.findOneAndUpdate(
      {
        _id: req.params.id,
        organizationId,
        type: "store",
        status: "paid",
        "store.fulfillmentStatus": "pending",
      },
      {
        $set: {
          "store.fulfillmentStatus": "delivered",
          "store.fulfilledAt": new Date(),
          "store.fulfilledBy": req.user?.userId || null,
        },
      },
      { new: true }
    );

    if (!order) {
      const existing = await Order.findOne({ _id: req.params.id, organizationId, type: "store" })
        .select("status store.fulfillmentStatus")
        .lean();
      if (!existing) return sendResponse(res, 404, null, "Pedido no encontrado.");
      if (existing.status !== "paid") {
        return sendResponse(res, 400, null, "Solo se pueden marcar entregados los pedidos pagados. Para contraentrega usa 'Registrar cobro y entregar'.");
      }
      return sendResponse(res, 409, null, "El pedido ya fue entregado o cancelado.");
    }

    return sendResponse(res, 200, { order }, "Pedido marcado como entregado.");
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

// POST /store-orders/:id/collect  { method: cash|card|transfer|other }  → { order }
// Contraentrega: registra el cobro (ProductSale con descuento ATÓMICO de stock),
// marca el pedido pagado y entregado. Si el stock ya no alcanza, la venta falla
// → 400 con el mensaje y el pedido NO cambia (claim revertido).
export const collectStoreOrder = async (req, res) => {
  try {
    const organizationId = req.organization?._id;
    const { method } = req.body;

    if (!COD_METHODS.includes(method)) {
      return sendResponse(res, 400, null, "Método de pago inválido (cash | card | transfer | other).");
    }

    // Claim atómico: solo un admin cobra el pedido (evita doble ProductSale).
    const order = await Order.findOneAndUpdate(
      {
        _id: req.params.id,
        organizationId,
        type: "store",
        provider: "cod",
        status: { $ne: "paid" },
        "store.fulfillmentStatus": "pending",
      },
      {
        $set: {
          status: "paid",
          paidAt: new Date(),
          "store.fulfillmentStatus": "delivered",
          "store.fulfilledAt": new Date(),
          "store.fulfilledBy": req.user?.userId || null,
        },
      },
      { new: true }
    );

    if (!order) {
      const existing = await Order.findOne({ _id: req.params.id, organizationId, type: "store" })
        .select("status provider store.fulfillmentStatus")
        .lean();
      if (!existing) return sendResponse(res, 404, null, "Pedido no encontrado.");
      if (existing.provider !== "cod") {
        return sendResponse(res, 400, null, "Este pedido no es contraentrega.");
      }
      return sendResponse(res, 409, null, "El pedido ya fue cobrado, entregado o cancelado.");
    }

    try {
      const sale = await productService.createSale(req.organization, {
        items: (order.store?.items || []).map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
        method,
        note: "Tienda online · Contraentrega",
        clientId: null,
        registeredBy: req.user?.userId || null,
      });

      order.store.saleId = sale._id;
      await Order.updateOne({ _id: order._id }, { $set: { "store.saleId": sale._id } });
    } catch (saleErr) {
      // Revertir el claim: el pedido queda EXACTAMENTE como estaba (decisión 3:
      // el conflicto de stock en el cobro COD sí es un error accionable → 400).
      await Order.updateOne(
        { _id: order._id },
        {
          $set: { status: "pending", "store.fulfillmentStatus": "pending" },
          $unset: { paidAt: 1, "store.fulfilledAt": 1, "store.fulfilledBy": 1 },
        }
      );
      return sendResponse(res, 400, null, saleErr.message || "No se pudo registrar la venta.");
    }

    // 🛍️ WhatsApp "Pago recibido" al comprador (best-effort; nunca rompe el cobro).
    notifyStorePaymentReceived({ org: req.organization, order }).catch((e) =>
      console.warn("[collectStoreOrder] notifyStorePaymentReceived falló:", e?.message || e)
    );

    return sendResponse(res, 200, { order }, "Cobro registrado y pedido entregado.");
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

// POST /store-orders/:id/cancel  → { order }
// Solo pedidos NO pagados (COD pendientes o checkouts online sin completar).
export const cancelStoreOrder = async (req, res) => {
  try {
    const organizationId = req.organization?._id;

    const order = await Order.findOneAndUpdate(
      {
        _id: req.params.id,
        organizationId,
        type: "store",
        status: { $ne: "paid" },
        "store.fulfillmentStatus": "pending",
      },
      { $set: { status: "failed", "store.fulfillmentStatus": "cancelled" } },
      { new: true }
    );

    if (!order) {
      const existing = await Order.findOne({ _id: req.params.id, organizationId, type: "store" })
        .select("status store.fulfillmentStatus")
        .lean();
      if (!existing) return sendResponse(res, 404, null, "Pedido no encontrado.");
      if (existing.status === "paid") {
        return sendResponse(res, 400, null, "No se puede cancelar un pedido ya pagado. Anula la venta en caja y gestiona el reembolso manualmente.");
      }
      return sendResponse(res, 409, null, "El pedido ya fue procesado.");
    }

    return sendResponse(res, 200, { order }, "Pedido cancelado.");
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

// DELETE /store-orders/:id  → elimina el pedido DEFINITIVAMENTE (no reversible).
// No toca stock ni ProductSale (la venta es registro contable de la caja).
// Bloqueado si: pagado sin entregar (primero entregar o gestionar reembolso) o
// comprobante en revisión (primero resolverlo en /gestionar-pagos).
export const deleteStoreOrder = async (req, res) => {
  try {
    const organizationId = req.organization?._id;

    // Guard en el filtro: el borrado solo procede en estados terminales o sin pago.
    const deleted = await Order.findOneAndDelete({
      _id: req.params.id,
      organizationId,
      type: "store",
      status: { $ne: "in_review" },
      $nor: [{ status: "paid", "store.fulfillmentStatus": "pending" }],
    });

    if (!deleted) {
      const existing = await Order.findOne({ _id: req.params.id, organizationId, type: "store" })
        .select("status store.fulfillmentStatus")
        .lean();
      if (!existing) return sendResponse(res, 404, null, "Pedido no encontrado.");
      if (existing.status === "in_review") {
        return sendResponse(res, 400, null, "El pedido tiene un comprobante en revisión. Apruébalo o recházalo en Comprobantes de pago antes de eliminarlo.");
      }
      return sendResponse(res, 400, null, "El pedido está pagado y sin entregar. Márcalo entregado (o gestiona el reembolso) antes de eliminarlo.");
    }

    return sendResponse(res, 200, null, "Pedido eliminado definitivamente.");
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};
