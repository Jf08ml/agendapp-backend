import express from "express";
import reservationController from "../controllers/reservationController.js";

const router = express.Router();

// Rutas para reservas
router.post("/", reservationController.createReservation);
router.post("/multi", reservationController.createMultipleReservations);
router.get(
  "/:organizationId",
  reservationController.getReservationsByOrganization
);
router.put("/:id", reservationController.updateReservation);
router.delete("/:id", reservationController.deleteReservation);

export default router;
