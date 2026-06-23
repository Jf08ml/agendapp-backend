import express from "express";
import {
  listReceiptOrders,
  reviewReceiptOrder,
} from "../controllers/receiptController.js";

// Bandeja de comprobantes (admin). Montada en /receipts con organizationResolver
// + verifyToken. Va en su propio mount para no chocar con `GET /organizations/:id`.
const router = express.Router();

router.get("/", listReceiptOrders);
router.post("/:id/review", reviewReceiptOrder);

export default router;
