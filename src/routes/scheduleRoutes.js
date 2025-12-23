/**
 * Rutas para gestión de horarios de disponibilidad
 */

import express from "express";
import scheduleController from "../controllers/scheduleController.js";

const router = express.Router();

// Rutas para horarios de organización
router.put("/organization/:orgId", scheduleController.updateOrganizationSchedule);
router.get("/organization/:orgId", scheduleController.getOrganizationSchedule);
router.get("/organization/:orgId/open-days", scheduleController.getOpenDays);

// Rutas para horarios de empleados
router.put("/employee/:employeeId", scheduleController.updateEmployeeSchedule);
router.get("/employee/:employeeId", scheduleController.getEmployeeSchedule);
router.get("/employee/:employeeId/available-days", scheduleController.getEmployeeAvailableDays);

// Rutas para consultar disponibilidad
router.post("/available-slots", scheduleController.getAvailableSlots);
router.post("/validate-datetime", scheduleController.validateDateTime);
router.post("/multi-service-blocks", scheduleController.getMultiServiceBlocks);
router.post("/available-slots-batch", scheduleController.getAvailableSlotsBatch);

export default router;
