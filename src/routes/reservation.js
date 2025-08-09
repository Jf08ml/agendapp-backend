import express from "express";
import reservationController from "../controllers/reservationController.js";

const router = express.Router();

// Rutas para reservas
router.post("/reservations", reservationController.createReservation);
router.post("/reservations/multi", reservationController.createMultipleReservations);
router.get(
  "/reservations/:organizationId",
  reservationController.getReservationsByOrganization
);
router.put("/reservations/:id", reservationController.updateReservation);
router.delete("/reservations/:id", reservationController.deleteReservation);

export default router;
