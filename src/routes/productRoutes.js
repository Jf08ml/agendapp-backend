import express from "express";
import productController from "../controllers/productController.js";

const router = express.Router();

// OJO: /sales va ANTES de /:id para que Express no capture "sales" como id
router.post("/sales", productController.createSale);
router.get("/sales", productController.getSales);
router.delete("/sales/:id", productController.deleteSale);

router.get("/", productController.getProducts);
router.post("/", productController.createProduct);
router.put("/:id", productController.updateProduct);
router.delete("/:id", productController.deactivateProduct);
router.post("/:id/stock", productController.adjustStock);

export default router;
