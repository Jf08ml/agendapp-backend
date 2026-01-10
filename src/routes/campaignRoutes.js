// routes/campaignRoutes.js
import express from "express";
import campaignController from "../controllers/campaignController.js";
// import { authUser } from "../middlewares/auth.js"; // Descomentar cuando sea necesario

const router = express.Router();

// Validar teléfonos antes de crear campaña
router.post(
  "/organizations/:orgId/campaigns/validate-phones",
  campaignController.validatePhones
);

// Obtener sugerencias de audiencia (clientes) - DEBE IR ANTES de las rutas genéricas
router.get(
  "/organizations/:orgId/campaigns/audience/suggestions",
  campaignController.getAudienceSuggestions
);

// Obtener TODOS los clientes (para seleccionar todos) - DEBE IR ANTES de las rutas genéricas
router.get(
  "/organizations/:orgId/campaigns/audience/all",
  campaignController.getAllClientsForCampaign
);

// Cancelar campaña en progreso - DEBE IR ANTES de /:campaignId
router.post(
  "/organizations/:orgId/campaigns/:campaignId/cancel",
  campaignController.cancelCampaign
);

// Convertir Dry Run a campaña real - DEBE IR ANTES de /:campaignId
router.post(
  "/organizations/:orgId/campaigns/:campaignId/convert-to-real",
  campaignController.convertDryRunToReal
);

// Crear y enviar campaña
router.post(
  "/organizations/:orgId/campaigns",
  campaignController.createCampaign
);

// Obtener detalle de una campaña específica
router.get(
  "/organizations/:orgId/campaigns/:campaignId",
  campaignController.getCampaignDetail
);

// Listar campañas de una organización - DEBE IR AL FINAL
router.get(
  "/organizations/:orgId/campaigns",
  campaignController.listCampaigns
);

export default router;
