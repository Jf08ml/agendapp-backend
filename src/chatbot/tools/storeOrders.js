import Order from "../../models/orderModel.js";
import * as storeController from "../../controllers/storeController.js";

function makeMockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.body = obj;
    return res;
  };
  return res;
}

const COD_METHOD_MAP = {
  efectivo: "cash", cash: "cash", contado: "cash",
  tarjeta: "card", card: "card",
  transferencia: "transfer", transfer: "transfer",
};

export default [
  {
    name: "get_store_orders",
    description:
      "Lista los pedidos de la tienda pública del negocio. Úsala cuando el usuario pregunte por pedidos pendientes de entregar, o por el estado de los pedidos de la tienda en general.",
    parameters: {
      status: { type: "string", description: "Filtro: 'pending' (por defecto), 'delivered', 'cancelled' o 'all'.", required: false },
    },
    handler: async (params, context) => {
      const fulfillment = params.status || "pending";
      const filter = { organizationId: context.organizationId, type: "store" };
      if (fulfillment !== "all") {
        filter["store.fulfillmentStatus"] = ["pending", "delivered", "cancelled"].includes(fulfillment) ? fulfillment : "pending";
      }
      const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(30).lean();

      if (orders.length === 0) {
        return { success: true, found: false, message: "No hay pedidos con ese filtro." };
      }

      return {
        success: true,
        total: orders.length,
        pedidos: orders.map((o) => ({
          id: o._id.toString(),
          cliente: o.store?.customer?.name || "?",
          telefono: o.store?.customer?.phone || null,
          items: (o.store?.items || []).map((i) => `${i.quantity}x ${i.name}`).join(", "),
          total: o.amount,
          entrega: o.store?.delivery?.mode || null,
          pagado: o.status === "paid",
          proveedorPago: o.provider,
          estadoEntrega: o.store?.fulfillmentStatus || null,
        })),
      };
    },
  },
  {
    name: "mark_order_delivered",
    description:
      "Marca un pedido de la tienda como entregado. Si el pedido ya fue pagado online (Mercado Pago o comprobante), solo lo marca entregado. Si el pedido es contraentrega (paga al recibir), además debes indicar el método de pago para registrar el cobro (efectivo, tarjeta o transferencia).",
    parameters: {
      orderId: { type: "string", description: "ID del pedido (obtenido de get_store_orders).", required: true },
      paymentMethod: { type: "string", description: "Método de pago SOLO para pedidos contraentrega: 'efectivo', 'tarjeta' o 'transferencia'. Omitir si el pedido ya estaba pagado online.", required: false },
    },
    handler: async (params, context) => {
      const order = await Order.findOne({ _id: params.orderId, organizationId: context.organizationId, type: "store" }).lean();
      if (!order) return { success: false, error: "No se encontró ese pedido." };

      const req = { params: { id: params.orderId }, organization: context.organization, user: context.user, body: {} };
      const res = makeMockRes();

      if (order.provider === "cod" && order.status !== "paid") {
        const method = COD_METHOD_MAP[String(params.paymentMethod || "").toLowerCase().trim()];
        if (!method) {
          return { success: false, error: "Este pedido es contraentrega y falta el método de pago. Pregunta al usuario: efectivo, tarjeta o transferencia." };
        }
        req.body.method = method;
        await storeController.collectStoreOrder(req, res);
      } else {
        await storeController.deliverStoreOrder(req, res);
      }

      if (res.statusCode >= 200 && res.statusCode < 300) {
        return { success: true, message: "Pedido marcado como entregado." };
      }
      return { success: false, error: res.body?.message || "No se pudo actualizar el pedido." };
    },
  },
];
