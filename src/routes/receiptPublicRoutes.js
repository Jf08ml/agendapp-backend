import express from "express";
import upload from "../middleware/uploadMiddleware.js";
import {
  createReceiptReservationCheckout,
  createReceiptClassCheckout,
  createReceiptPackageCheckout,
  submitReceipt,
} from "../controllers/receiptController.js";
import { getOrderStatus } from "../controllers/collectionController.js";
import { createReceiptStoreCheckout } from "../controllers/storeController.js";

// Rutas públicas del cobro por transferencia + comprobante con IA (sin auth).
// Montadas bajo /collection. La org se identifica por el body (checkout) o por la
// orden (submit). El polling de estado reusa getOrderStatus.
const router = express.Router();

router.post("/receipt/reservation", createReceiptReservationCheckout);
router.post("/receipt/class", createReceiptClassCheckout);
router.post("/receipt/package", createReceiptPackageCheckout);
router.post("/receipt/store", createReceiptStoreCheckout); // pedido de tienda pública
router.post("/receipt/:externalReference", upload.single("image"), submitReceipt);
router.get("/order/:externalReference", getOrderStatus);

export default router;
