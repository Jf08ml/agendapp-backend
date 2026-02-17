import express from "express";
import reservationController from "../controllers/reservationController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { organizationResolver } from "../middleware/organizationResolver.js";

const router = express.Router();

// 🌐 Rutas PÚBLICAS (sin autenticación) - Para reserva en línea
router.post("/multi", reservationController.createMultipleReservations);
router.post("/multi/preview", reservationController.previewRecurringReservations);

// 🔒 Rutas PROTEGIDAS (requieren autenticación)
router.post("/", organizationResolver, verifyToken, reservationController.createReservation);
router.get(
  "/:organizationId",
  organizationResolver,
  verifyToken,
  reservationController.getReservationsByOrganization
);
router.put("/:id", organizationResolver, verifyToken, reservationController.updateReservation);
router.put("/:id/cancel", organizationResolver, verifyToken, reservationController.cancelReservation);
router.delete("/:id", organizationResolver, verifyToken, reservationController.deleteReservation);

export default router;
