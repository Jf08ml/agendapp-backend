import express from "express";
import whatsappTemplateController from "../controllers/whatsappTemplateController.js";

const router = express.Router();

/**
 * Rutas para gestionar plantillas de WhatsApp personalizadas
 * Base: /api/organizations/:organizationId/whatsapp-templates
 */

// Obtener todas las plantillas de una organización
router.get("/:organizationId", whatsappTemplateController.getTemplates);

// Actualizar una plantilla específica
router.put("/:organizationId/template", whatsappTemplateController.updateTemplate);

// Restaurar una plantilla a su versión por defecto
router.post("/:organizationId/reset", whatsappTemplateController.resetTemplate);

// Actualizar todas las plantillas
router.put("/:organizationId/all", whatsappTemplateController.updateAllTemplates);

// Preview de una plantilla con datos de ejemplo
router.post("/preview", whatsappTemplateController.previewTemplate);

export default router;
