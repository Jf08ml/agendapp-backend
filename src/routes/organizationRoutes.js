import express from "express";
import organizationController from "../controllers/organizationController.js";
import waController from "../controllers/waController.js";

const router = express.Router();

// Ruta para crear una nueva organización
router.post("/", organizationController.createOrganization);

// Ruta para obtener todas las organizaciones
router.get("/", organizationController.getOrganizations);

// Ruta para obtener una organización específica por ID
router.get("/:id", organizationController.getOrganizationById);

// Ruta para actualizar una organización específica por ID
router.put("/:id", organizationController.updateOrganization);

// Ruta para eliminar una organización específica por ID
router.delete("/:id", organizationController.deleteOrganization);

// WhatsApp routes for organization
router.post("/:id/wa/connect", waController.connectSession);
router.get("/:id/wa/status", waController.getStatus);
router.post("/:id/wa/send", waController.send);
router.post("/:id/wa/restart", waController.restart);
router.post("/:id/wa/logout", waController.logout);

export default router;
