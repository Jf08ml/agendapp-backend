/**
 * Rutas para gestión de horarios de disponibilidad
 */

import express from "express";
import scheduleController from "../controllers/scheduleController.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// 🌐 Rutas PÚBLICAS (sin autenticación) - Para consultar disponibilidad en reserva en línea
router.post("/available-slots", scheduleController.getAvailableSlots);
router.post("/validate-datetime", scheduleController.validateDateTime);
router.post("/multi-service-blocks", scheduleController.getMultiServiceBlocks);
router.post("/available-slots-batch", scheduleController.getAvailableSlotsBatch);
router.post("/check-days-availability", scheduleController.checkDaysAvailability);

// 🔒 Rutas PROTEGIDAS (requieren autenticación) - Para gestión de horarios
router.put("/organization/:orgId", verifyToken, scheduleController.updateOrganizationSchedule);
router.get("/organization/:orgId", verifyToken, scheduleController.getOrganizationSchedule);
router.get("/organization/:orgId/open-days", verifyToken, scheduleController.getOpenDays);
router.put("/employee/:employeeId", verifyToken, scheduleController.updateEmployeeSchedule);
router.get("/employee/:employeeId", verifyToken, scheduleController.getEmployeeSchedule);
router.get("/employee/:employeeId/available-days", verifyToken, scheduleController.getEmployeeAvailableDays);
router.get("/employee/:employeeId/exceptions", verifyToken, scheduleController.getEmployeeExceptions);
router.post("/employee/:employeeId/exceptions", verifyToken, scheduleController.addEmployeeException);
router.delete("/employee/:employeeId/exceptions/:exceptionId", verifyToken, scheduleController.removeEmployeeException);

export default router;
