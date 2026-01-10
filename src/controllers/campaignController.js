// controllers/campaignController.js
import { campaignService } from "../services/campaignService.js";
import sendResponse from "../utils/sendResponse.js";

const campaignController = {
  /**
   * POST /organizations/:orgId/campaigns/validate-phones
   * Valida y normaliza teléfonos antes de crear campaña
   */
  validatePhones: async (req, res) => {
    try {
      const orgId = req.params.orgId;
      const { phones = [] } = req.body;

      if (!Array.isArray(phones) || phones.length === 0) {
        return sendResponse(
          res,
          400,
          null,
          "Debes proporcionar un array de teléfonos"
        );
      }

      const validation = await campaignService.validatePhones({
        phones,
        orgId,
      });

      return sendResponse(res, 200, { validation }, "Validación completada");
    } catch (error) {
      console.error("Error validando teléfonos:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * POST /organizations/:orgId/campaigns
   * Crear y enviar campaña
   */
  createCampaign: async (req, res) => {
    try {
      const orgId = req.params.orgId;
      const userId = req.user?.id || req.user?._id;
      const { title, message, recipients, image, dryRun = false } = req.body;

      // Validaciones
      if (!title || !message) {
        return sendResponse(
          res,
          400,
          null,
          "Título y mensaje son obligatorios"
        );
      }

      if (!Array.isArray(recipients) || recipients.length === 0) {
        return sendResponse(
          res,
          400,
          null,
          "Debes proporcionar al menos un destinatario"
        );
      }

      if (message.length > 1000) {
        return sendResponse(
          res,
          400,
          null,
          "El mensaje no puede exceder 1000 caracteres"
        );
      }

      const result = await campaignService.createAndSend({
        orgId,
        userId,
        title,
        message,
        recipients,
        image,
        dryRun,
      });

      return sendResponse(
        res,
        201,
        result,
        dryRun ? "Campaña simulada (dry run)" : "Campaña creada y enviándose"
      );
    } catch (error) {
      console.error("Error creando campaña:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * GET /organizations/:orgId/campaigns
   * Listar campañas
   */
  listCampaigns: async (req, res) => {
    try {
      const orgId = req.params.orgId;
      const { page = 1, limit = 10, status } = req.query;

      const result = await campaignService.listCampaigns({
        orgId,
        page: parseInt(page),
        limit: parseInt(limit),
        status,
      });

      return sendResponse(res, 200, result, "Campañas obtenidas");
    } catch (error) {
      console.error("Error listando campañas:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * GET /organizations/:orgId/campaigns/:campaignId
   * Detalle de campaña
   */
  getCampaignDetail: async (req, res) => {
    try {
      const { orgId, campaignId } = req.params;

      const result = await campaignService.getCampaignDetail({
        orgId,
        campaignId,
      });

      return sendResponse(res, 200, result, "Detalle de campaña obtenido");
    } catch (error) {
      console.error("Error obteniendo detalle de campaña:", error);
      return sendResponse(res, 404, null, error.message);
    }
  },

  /**
   * POST /organizations/:orgId/campaigns/:campaignId/cancel
   * Cancelar campaña en progreso
   */
  cancelCampaign: async (req, res) => {
    try {
      const { orgId, campaignId } = req.params;

      const result = await campaignService.cancelCampaign({
        orgId,
        campaignId,
      });

      return sendResponse(res, 200, result, "Campaña cancelada");
    } catch (error) {
      console.error("Error cancelando campaña:", error);
      return sendResponse(res, 400, null, error.message);
    }
  },

  /**
   * GET /organizations/:orgId/campaigns/audience/suggestions
   * Obtener sugerencias de audiencia (clientes)
   */
  getAudienceSuggestions: async (req, res) => {
    try {
      const orgId = req.params.orgId;
      const { search = "", limit = 50, page = 1 } = req.query;

      const result = await campaignService.getAudienceSuggestions({
        orgId,
        search,
        limit: parseInt(limit),
        page: parseInt(page),
      });

      return sendResponse(res, 200, result, "Sugerencias obtenidas");
    } catch (error) {
      console.error("Error obteniendo sugerencias:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * GET /organizations/:orgId/campaigns/audience/all
   * Obtener TODOS los clientes (para seleccionar todos)
   */
  getAllClientsForCampaign: async (req, res) => {
    try {
      const orgId = req.params.orgId;
      const { search = "" } = req.query;

      const result = await campaignService.getAllClientsForCampaign({
        orgId,
        search,
      });

      return sendResponse(res, 200, result, "Todos los clientes obtenidos");
    } catch (error) {
      console.error("Error obteniendo todos los clientes:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * POST /organizations/:orgId/campaigns/:campaignId/convert-to-real
   * Convertir Dry Run a campaña real
   */
  convertDryRunToReal: async (req, res) => {
    try {
      const orgId = req.params.orgId;
      const campaignId = req.params.campaignId;
      const userId = req.user?.id || req.user?._id;

      const result = await campaignService.convertDryRunToReal({
        orgId,
        campaignId,
        userId,
      });

      return sendResponse(res, 200, result, "Campaña real creada exitosamente");
    } catch (error) {
      console.error("Error convirtiendo Dry Run a real:", error);
      return sendResponse(res, 500, null, error.message);
    }
  },
};

export default campaignController;
