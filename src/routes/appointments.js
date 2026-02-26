import express from "express";
import appointmentController from "../controllers/appointmentController.js";

const router = express.Router();

// Crear una nueva cita
router.post("/", appointmentController.createAppointment);

// Crear múltiples citas (batch)
router.post("/batch", appointmentController.createAppointmentsBatch);

// Confirmar múltiples citas (batch)
router.put("/batch/confirm", appointmentController.batchConfirmAppointments);

// 🔁 Crear/previsualizar serie de citas recurrentes
router.post("/series", appointmentController.createAppointmentSeries);

// Obtener todas las citas
router.get("/", appointmentController.getAppointments);

// Obtener citas por organizationId
router.get(
  "/organization/:organizationId/dates",
  appointmentController.getAppointmentsByOrganizationWithDates
);

// Obtener agregados (buckets) por organizationId (day|week|month)
router.get(
  "/organization/:organizationId/aggregated",
  appointmentController.getAppointmentsAggregated
);

// Obtener una cita específica por ID
router.get("/:id", appointmentController.getAppointmentById);

// Actualizar una cita específica por ID
router.put("/:id", appointmentController.updateAppointment);

// Marcar asistencia (attended / no_show)
router.patch("/:appointmentId/attendance", appointmentController.markAttendance);

// Cancelar una cita (cambia estado a cancelled_by_admin, mantiene historial)
router.patch("/:id/cancel", appointmentController.cancelAppointment);

// 💰 Registrar/eliminar pagos de una cita
router.post("/:id/payments", appointmentController.addPayment);
router.delete("/:id/payments/:paymentId", appointmentController.removePayment);

// Eliminar una cita definitivamente (sin historial)
router.delete("/:id", appointmentController.deleteAppointment);

// Obtener todas las citas de un empleado específico
router.get(
  "/employee/:employeeId",
  appointmentController.getAppointmentsByEmployee
);

router.get(
  "/client/:clientId",
  appointmentController.getAppointmentsByClient
);

export default router;
