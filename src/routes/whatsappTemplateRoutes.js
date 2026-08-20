import express from "express";
import whatsappTemplateController from "../controllers/whatsappTemplateController.js";

const router = express.Router();

/**
 * Rutas para gestionar plantillas de WhatsApp personalizadas
 * Base: /api/whatsapp-templates/:organizationId
 *
 * Estas rutas montan organizationResolver (ver indexRoutes.js), que resuelve
 * req.organization a partir del dominio/tenant del request. El :organizationId
 * de la URL debe coincidir con esa organización real — si no, se rechaza. Sin
 * este chequeo, cualquier usuario autenticado podía leer/sobrescribir las
 * plantillas de CUALQUIER organización con solo cambiar el ID en la URL.
 */
function requireOwnOrganization(req, res, next) {
  if (!req.organization || String(req.organization._id) !== req.params.organizationId) {
    return res.status(403).json({
      result: "error",
      message: "No tienes acceso a esta organización",
    });
  }
  next();
}

// Obtener todas las plantillas de una organización
router.get("/:organizationId", requireOwnOrganization, whatsappTemplateController.getTemplates);

// Actualizar una plantilla específica
router.put("/:organizationId/template", requireOwnOrganization, whatsappTemplateController.updateTemplate);

// Restaurar una plantilla a su versión por defecto
router.post("/:organizationId/reset", requireOwnOrganization, whatsappTemplateController.resetTemplate);

// Actualizar todas las plantillas
router.put("/:organizationId/all", requireOwnOrganization, whatsappTemplateController.updateAllTemplates);

// Preview de una plantilla con datos de ejemplo
router.post("/preview", whatsappTemplateController.previewTemplate);

// 🆕 Obtener configuración de envíos (habilitar/deshabilitar mensajes)
router.get("/:organizationId/settings", requireOwnOrganization, whatsappTemplateController.getTemplateSettings);

// 🆕 Actualizar configuración de envíos
router.put("/:organizationId/settings", requireOwnOrganization, whatsappTemplateController.updateTemplateSettings);

// 🎂 Actualizar beneficio de cumpleaños ({{beneficio}})
router.put("/:organizationId/birthday-benefit", requireOwnOrganization, whatsappTemplateController.updateBirthdayBenefit);

export default router;
