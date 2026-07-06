import express from "express";
import {
  listStoreOrders,
  deliverStoreOrder,
  collectStoreOrder,
  cancelStoreOrder,
  deleteStoreOrder,
} from "../controllers/storeController.js";

// Bandeja admin de pedidos de la tienda. Montada en /store-orders (Grupo 4 de
// indexRoutes) con organizationResolver + verifyToken + requireActiveMembership.
const router = express.Router();

router.get("/", listStoreOrders);
router.post("/:id/deliver", deliverStoreOrder);
router.post("/:id/collect", collectStoreOrder);
router.post("/:id/cancel", cancelStoreOrder);
router.delete("/:id", deleteStoreOrder);

export default router;
