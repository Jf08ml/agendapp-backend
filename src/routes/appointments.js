import express from "express";
import appointmentController from "../controllers/appointmentController.js";

const router = express.Router();

// Crear una nueva cita
router.post("/appointments", appointmentController.createAppointment);

// Crear múltiples citas (batch)
router.post("/appointments/batch", appointmentController.createAppointmentsBatch);

// Confirmar múltiples citas (batch)
router.put("/appointments/batch/confirm", appointmentController.batchConfirmAppointments);

// 🔁 Crear/previsualizar serie de citas recurrentes
router.post("/appointments/series", appointmentController.createAppointmentSeries);

// Obtener todas las citas
router.get("/appointments", appointmentController.getAppointments);

// Obtener citas por organizationId
router.get(
  "/appointments/organization/:organizationId/dates",
  appointmentController.getAppointmentsByOrganizationWithDates
);

// Obtener agregados (buckets) por organizationId (day|week|month)
router.get(
  "/appointments/organization/:organizationId/aggregated",
  appointmentController.getAppointmentsAggregated
);

// Obtener una cita específica por ID
router.get("/appointments/:id", appointmentController.getAppointmentById);

// Actualizar una cita específica por ID
router.put("/appointments/:id", appointmentController.updateAppointment);

// Eliminar una cita específica por ID
router.delete("/appointments/:id", appointmentController.deleteAppointment);

// Obtener todas las citas de un empleado específico
router.get(
  "/appointments/employee/:employeeId",
  appointmentController.getAppointmentsByEmployee
);

router.get(
  "/appointments/client/:clientId",
  appointmentController.getAppointmentsByClient
);

export default router;
