// routes/reminderRoutes.js
import express from "express";
import reminderController from "../controllers/reminderController.js";
// import { authUser, requireOrgRole } from "../middlewares/auth.js";

const router = express.Router();

// Por organización (para tu botón en UI)
router.post(
  "/organizations/:id/wa/reminders",
  reminderController.sendForOrganization
);

// Global (opcional, panel admin)
router.post("/wa/reminders", reminderController.sendAll);

export default router;
