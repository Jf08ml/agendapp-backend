import productService from "../services/productService.js";
import sendResponse from "../utils/sendResponse.js";

const productController = {
  // Crear producto
  createProduct: async (req, res) => {
    try {
      if (!req.organization) return sendResponse(res, 400, null, "Organización no identificada");
      const { name, salePrice } = req.body;
      if (!name || !String(name).trim()) return sendResponse(res, 400, null, "El nombre del producto es obligatorio");
      if (salePrice == null || Number(salePrice) < 0) return sendResponse(res, 400, null, "El precio de venta es obligatorio");
      const product = await productService.createProduct(req.organization._id, req.body);
      sendResponse(res, 201, product, "Producto creado exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Obtener productos de la organización
  getProducts: async (req, res) => {
    try {
      if (!req.organization) return sendResponse(res, 400, null, "Organización no identificada");
      const { includeInactive, search } = req.query;
      const products = await productService.getProducts(req.organization._id, {
        includeInactive: includeInactive === "true",
        search,
      });
      sendResponse(res, 200, products, "Productos obtenidos exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Actualizar producto
  updateProduct: async (req, res) => {
    try {
      if (!req.organization) return sendResponse(res, 400, null, "Organización no identificada");
      const product = await productService.updateProduct(req.organization._id, req.params.id, req.body);
      if (!product) return sendResponse(res, 404, null, "Producto no encontrado");
      sendResponse(res, 200, product, "Producto actualizado exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Desactivar producto (soft-delete)
  deactivateProduct: async (req, res) => {
    try {
      if (!req.organization) return sendResponse(res, 400, null, "Organización no identificada");
      const product = await productService.deactivateProduct(req.organization._id, req.params.id);
      if (!product) return sendResponse(res, 404, null, "Producto no encontrado");
      sendResponse(res, 200, product, "Producto desactivado exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Ajuste manual de stock
  adjustStock: async (req, res) => {
    try {
      if (!req.organization) return sendResponse(res, 400, null, "Organización no identificada");
      const { delta, reason } = req.body;
      const registeredBy = req.user?.userId || null;
      const product = await productService.adjustStock(
        req.organization._id,
        req.params.id,
        delta,
        reason,
        registeredBy
      );
      sendResponse(res, 200, product, "Stock ajustado exitosamente");
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  // Registrar venta de productos
  createSale: async (req, res) => {
    try {
      if (!req.organization) return sendResponse(res, 400, null, "Organización no identificada");
      const registeredBy = req.user?.userId || null;
      const sale = await productService.createSale(req.organization, { ...req.body, registeredBy });
      sendResponse(res, 201, sale, "Venta registrada exitosamente");
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  // Obtener ventas por rango de fechas
  getSales: async (req, res) => {
    try {
      if (!req.organization) return sendResponse(res, 400, null, "Organización no identificada");
      const { startDate, endDate } = req.query;
      const sales = await productService.getSales(req.organization._id, { startDate, endDate });
      sendResponse(res, 200, sales, "Ventas obtenidas exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Anular venta (repone stock)
  deleteSale: async (req, res) => {
    try {
      if (!req.organization) return sendResponse(res, 400, null, "Organización no identificada");
      const sale = await productService.deleteSale(req.organization._id, req.params.id);
      if (!sale) return sendResponse(res, 404, null, "Venta no encontrada");
      sendResponse(res, 200, null, "Venta anulada exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },
};

export default productController;
