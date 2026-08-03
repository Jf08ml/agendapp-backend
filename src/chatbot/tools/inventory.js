import Product from "../../models/productModel.js";
import productService from "../../services/productService.js";

const escapeRegex = (str) => String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default [
  {
    name: "get_low_stock_products",
    description:
      "Lista los productos de inventario cuyo stock está en o por debajo del umbral de alerta configurado. Úsala cuando el usuario pregunte qué productos se están agotando o necesitan reabastecerse.",
    parameters: {},
    handler: async (_params, context) => {
      const products = await Product.find({
        organizationId: context.organizationId,
        active: true,
        trackStock: true,
        lowStockThreshold: { $gt: 0 },
        $expr: { $lte: ["$stockQuantity", "$lowStockThreshold"] },
      })
        .select("name category stockQuantity lowStockThreshold")
        .sort({ stockQuantity: 1 });

      if (products.length === 0) {
        return { success: true, found: false, message: "No hay productos con stock bajo en este momento." };
      }

      return {
        success: true,
        total: products.length,
        productos: products.map((p) => ({
          id: p._id,
          nombre: p.name,
          categoria: p.category || null,
          stockActual: p.stockQuantity,
          umbralAlerta: p.lowStockThreshold,
        })),
      };
    },
  },
  {
    name: "adjust_product_stock",
    description:
      "Ajusta el stock de un producto (suma o resta unidades), con un motivo. Úsala cuando el usuario diga que recibió mercancía, hizo un conteo físico, o encontró unidades dañadas/perdidas. Para AUMENTAR usa delta positivo, para DISMINUIR usa delta negativo.",
    parameters: {
      productName: { type: "string", description: "Nombre (parcial) del producto a ajustar.", required: true },
      delta: { type: "number", description: "Cambio en unidades: positivo para sumar stock, negativo para restar. Ej: 10 para agregar 10 unidades, -3 para quitar 3.", required: true },
      reason: { type: "string", description: "Motivo del ajuste (ej: 'reposición de mercancía', 'conteo físico', 'producto dañado').", required: true },
    },
    handler: async (params, context) => {
      if (!params.delta || Number(params.delta) === 0) {
        return { success: false, error: "El ajuste (delta) no puede ser 0." };
      }

      const product = await Product.findOne({
        organizationId: context.organizationId,
        active: true,
        name: { $regex: escapeRegex(params.productName), $options: "i" },
      });
      if (!product) {
        return { success: false, error: `No se encontró un producto activo llamado "${params.productName}".` };
      }

      try {
        const updated = await productService.adjustStock(
          context.organizationId,
          product._id.toString(),
          Number(params.delta),
          params.reason,
          context.user?.userId || null
        );
        return {
          success: true,
          producto: updated.name,
          ajuste: Number(params.delta),
          stockNuevo: updated.stockQuantity,
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  },
];
