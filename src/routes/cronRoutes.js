import express from "express";
import cronController from "../controllers/cronController.js";
import membershipController from "../controllers/membershipController.js";

const router = express.Router();

// Ruta para ejecutar el cron job de recordatorios
router.get("/cron/daily-reminder", cronController.runDailyReminder);

// Ruta para ejecutar el cron job de verificación de membresías
router.get("/cron/check-memberships", membershipController.runMembershipCheckManual);

export default router;
