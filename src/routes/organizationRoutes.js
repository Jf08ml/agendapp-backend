import express from "express";
import organizationController from "../controllers/organizationController.js";
import waController from "../controllers/waController.js";
import { requirePermission, PERMS } from "../middleware/requirePermission.js";

// Permisos del panel (además de requireOrganizationAccess en el montaje)
const canEditSettings = requirePermission(...PERMS.businessSettings);
const canUseWhatsapp = requirePermission(...PERMS.whatsapp);

const router = express.Router();

// Ruta para crear una nueva organización
router.post("/", organizationController.createOrganization);

// Ruta para obtener todas las organizaciones
router.get("/", organizationController.getOrganizations);

// Ruta para obtener una organización específica por ID
router.get("/:id", organizationController.getOrganizationById);

// Ruta para actualizar una organización específica por ID
router.put("/:id", canEditSettings, organizationController.updateOrganization);

// Ruta para eliminar una organización específica por ID
router.delete("/:id", organizationController.deleteOrganization);

// Sembrar datos de ejemplo (onboarding "Explorar primero")
router.post("/:id/seed-demo", canEditSettings, organizationController.seedDemoData);

// WhatsApp routes for organization
router.post("/:id/wa/connect", canUseWhatsapp, waController.connectSession);
router.get("/:id/wa/status", canUseWhatsapp, waController.getStatus);
router.post("/:id/wa/send", canUseWhatsapp, waController.send);
router.post("/:id/wa/welcome-test", canUseWhatsapp, waController.welcomeTest);
router.post("/:id/wa/restart", canUseWhatsapp, waController.restart);
router.post("/:id/wa/logout", canUseWhatsapp, waController.logout);

export default router;
