import express from "express";
import { organizationResolver } from "../middleware/organizationResolver.js";
import {
  getStoreCatalog,
  createStoreCheckout,
  createStoreCodOrder,
} from "../controllers/storeController.js";

// Rutas PÚBLICAS de la tienda (sin auth, sin membership check). Montadas bajo
// /store en el Grupo 1 de indexRoutes (junto a /collection). El catálogo resuelve
// la org por dominio (organizationResolver) o ?org=; los checkouts la reciben en
// el body (mismo patrón que /collection). El pago por comprobante vive en
// receiptPublicRoutes (POST /collection/receipt/store).
const router = express.Router();

router.get("/catalog", organizationResolver, getStoreCatalog);
router.post("/checkout", createStoreCheckout); // Mercado Pago
router.post("/cod", createStoreCodOrder); // contraentrega

export default router;
