import Product from "../models/productModel.js";
import ProductSale from "../models/productSaleModel.js";
import Employee from "../models/employeeModel.js";
import { checkAndNotifyLowStock } from "./lowStockNotifier.js";

const VALID_METHODS = ["cash", "card", "transfer", "other"];

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const productService = {
  // =============================================
  // CRUD de productos
  // =============================================

  createProduct: async (organizationId, data) => {
    const { organizationId: _ignored, lowStockNotifiedAt: _ignored2, ...fields } = data;
    return await Product.create({ ...fields, organizationId });
  },

  getProducts: async (organizationId, { includeInactive, search } = {}) => {
    const filter = { organizationId };
    if (!includeInactive) filter.active = true;
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ name: regex }, { sku: regex }, { barcode: regex }, { category: regex }];
    }
    return await Product.find(filter).sort({ name: 1 });
  },

  updateProduct: async (organizationId, productId, data) => {
    // El stock NUNCA se edita directo: solo vía adjustStock ($inc atómico)
    const { organizationId: _ignored, stockQuantity: _ignored2, lowStockNotifiedAt: _ignored3, ...fields } = data;
    return await Product.findOneAndUpdate(
      { _id: productId, organizationId },
      fields,
      { new: true }
    );
  },

  // Soft-delete: las ventas referencian el id, no se borra el doc
  deactivateProduct: async (organizationId, productId) => {
    return await Product.findOneAndUpdate(
      { _id: productId, organizationId },
      { active: false },
      { new: true }
    );
  },

  // =============================================
  // Ajuste manual de stock (atómico)
  // =============================================

  // `reason` y `registeredBy` se reciben para el contrato del endpoint;
  // en el MVP no se persiste historial de movimientos.
  adjustStock: async (organizationId, productId, delta, reason, registeredBy) => {
    const numericDelta = Number(delta);
    if (!Number.isFinite(numericDelta) || numericDelta === 0) {
      throw new Error("El ajuste de stock debe ser un número distinto de 0");
    }

    const updated = await Product.findOneAndUpdate(
      {
        _id: productId,
        organizationId,
        ...(numericDelta < 0 ? { stockQuantity: { $gte: -numericDelta } } : {}),
      },
      { $inc: { stockQuantity: numericDelta } },
      { new: true }
    );

    if (!updated) {
      const exists = await Product.exists({ _id: productId, organizationId });
      if (!exists) throw new Error("Producto no encontrado");
      throw new Error("Stock insuficiente");
    }

    // Re-armar la alerta de stock bajo tras reabastecer por encima del umbral
    if (updated.lowStockNotifiedAt && updated.stockQuantity > updated.lowStockThreshold) {
      await Product.updateOne({ _id: updated._id }, { lowStockNotifiedAt: null });
      updated.lowStockNotifiedAt = null;
    }

    return updated;
  },

  // =============================================
  // Ventas
  // =============================================

  createSale: async (org, data) => {
    const organizationId = org._id;
    const { items, method, soldBy, clientId, appointmentId, date, note, registeredBy } = data;

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("La venta debe incluir al menos un producto");
    }

    // 1. Cargar productos activos de la org y validar items
    const products = await Product.find({
      _id: { $in: items.map((i) => i.productId) },
      organizationId,
      active: true,
    });
    const productMap = new Map(products.map((p) => [p._id.toString(), p]));

    const normalizedItems = items.map((item) => {
      const product = productMap.get(String(item.productId));
      if (!product) throw new Error("Producto no encontrado o inactivo");
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error(`Cantidad inválida para ${product.name}`);
      }
      const unitPrice = item.unitPrice != null ? Number(item.unitPrice) : product.salePrice;
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error(`Precio inválido para ${product.name}`);
      }
      return { product, quantity, unitPrice };
    });

    // Cargar al vendedor ANTES de tocar stock (si falla, no hay nada que revertir)
    const employee = soldBy ? await Employee.findOne({ _id: soldBy, organizationId }) : null;

    // 2. Descuento atómico de stock por item, con compensación manual si falla
    const decremented = [];
    const compensate = async () => {
      for (const done of decremented) {
        await Product.updateOne(
          { _id: done.productId, organizationId },
          { $inc: { stockQuantity: done.quantity } }
        );
      }
    };

    for (const item of normalizedItems) {
      if (!item.product.trackStock) continue;
      const updated = await Product.findOneAndUpdate(
        { _id: item.product._id, organizationId, stockQuantity: { $gte: item.quantity } },
        { $inc: { stockQuantity: -item.quantity } },
        { new: true }
      );
      if (!updated) {
        await compensate();
        throw new Error(`Stock insuficiente para ${item.product.name}`);
      }
      decremented.push({ productId: item.product._id, quantity: item.quantity });
    }

    try {
      // 3. Total y comisión (snapshot). Prioridad: config del producto → config del empleado
      const total = normalizedItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

      let commissionAmount = 0;
      if (employee) {
        for (const item of normalizedItems) {
          let type = null;
          let value = 0;
          if (item.product.commissionType && item.product.commissionValue) {
            type = item.product.commissionType;
            value = item.product.commissionValue;
          } else if (employee.commissionType && employee.commissionValue) {
            type = employee.commissionType;
            value = employee.commissionValue;
          }
          if (!type || !value) continue; // sin comisión configurada
          const subtotal = item.quantity * item.unitPrice;
          commissionAmount += type === "percentage" ? subtotal * (value / 100) : item.quantity * value;
        }
      }

      // 4. Crear la venta con snapshots
      const sale = await ProductSale.create({
        organizationId,
        items: normalizedItems.map((i) => ({
          productId: i.product._id,
          name: i.product.name,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          costPrice: i.product.costPrice || 0,
        })),
        total,
        method: VALID_METHODS.includes(method) ? method : "cash",
        soldBy: employee ? employee._id : null,
        commissionAmount,
        clientId: clientId || null,
        appointmentId: appointmentId || null,
        date: date || new Date(),
        note: note || "",
        registeredBy: registeredBy || null,
      });

      // 5. Alerta de stock bajo — best-effort, jamás tumba la venta
      checkAndNotifyLowStock({ org, productIds: decremented.map((d) => d.productId) }).catch(
        (err) => console.error("[productService] Error notificando stock bajo:", err?.message || err)
      );

      return sale;
    } catch (error) {
      await compensate();
      throw error;
    }
  },

  getSales: async (organizationId, { startDate, endDate } = {}) => {
    const filter = { organizationId };
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }
    return await ProductSale.find(filter)
      .sort({ date: -1 })
      .populate("soldBy", "names")
      .populate("clientId", "name");
  },

  // Anular venta: repone el stock (solo productos que controlan stock) y elimina el doc
  deleteSale: async (organizationId, saleId) => {
    const sale = await ProductSale.findOne({ _id: saleId, organizationId });
    if (!sale) return null;

    const products = await Product.find({
      _id: { $in: sale.items.map((i) => i.productId) },
      organizationId,
    });
    const trackable = new Set(
      products.filter((p) => p.trackStock).map((p) => p._id.toString())
    );

    const restoredIds = [];
    for (const item of sale.items) {
      if (!trackable.has(item.productId.toString())) continue;
      await Product.updateOne(
        { _id: item.productId, organizationId },
        { $inc: { stockQuantity: item.quantity } }
      );
      restoredIds.push(item.productId);
    }

    // Re-armar la alerta si la reposición dejó el stock por encima del umbral
    if (restoredIds.length > 0) {
      await Product.updateMany(
        {
          _id: { $in: restoredIds },
          lowStockNotifiedAt: { $ne: null },
          $expr: { $gt: ["$stockQuantity", "$lowStockThreshold"] },
        },
        { lowStockNotifiedAt: null }
      );
    }

    await ProductSale.deleteOne({ _id: sale._id });
    return sale;
  },
};

export default productService;
