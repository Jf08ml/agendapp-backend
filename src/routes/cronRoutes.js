import express from "express";
import cronController from "../controllers/cronController.js";
import membershipController from "../controllers/membershipController.js";

const router = express.Router();

// Ruta para ejecutar el cron job de recordatorios
router.get("/cron/daily-reminder", cronController.runDailyReminder);

// Ruta para ejecutar el cron job de verificación de membresías
router.get("/cron/check-memberships", membershipController.runMembershipCheckManual);

// Ruta para auto-confirmar citas del día (manual)
router.get("/cron/auto-confirm-today", cronController.runAutoConfirmAppointments);

export default router;
