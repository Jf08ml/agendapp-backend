// controllers/waController.js
import { waIntegrationService } from "../services/waIntegrationService.js";
import sendResponse from "../utils/sendResponse.js";

const waController = {
  /** POST /organizations/:id/wa/connect { clientId } */
  connectSession: async (req, res) => {
    try {
      const orgId = req.params.id;
      const { clientId, pairingPhone } = req.body;
      if (!clientId) return sendResponse(res, 400, null, "Falta clientId");
      const userId = req.user?.id || "system";
      const data = await waIntegrationService.connectOrganizationSession({
        orgId,
        clientId,
        userId,
        pairingPhone,
      });
      sendResponse(res, 200, data, "Sesión de WhatsApp inicializada");
    } catch (err) {
      console.error(err);
      sendResponse(res, 500, null, err.message);
    }
  },

  /** GET /organizations/:id/wa/status */
  getStatus: async (req, res) => {
    try {
      const orgId = req.params.id;
      const data = await waIntegrationService.getOrganizationWaStatus({
        orgId,
      });
      // Si quieres simplificar, podrías responder solo data.waStatus
      sendResponse(res, 200, data, "Status de WhatsApp");
    } catch (err) {
      sendResponse(res, 404, null, err.message);
    }
  },

  /** POST /organizations/:id/wa/send { clientId?, phone, message?, image? } */
  send: async (req, res) => {
    try {
      const orgId = req.params.id;
      const { clientId, phone, message, image } = req.body || {};
      const data = await waIntegrationService.sendMessage({
        orgId,
        clientId,
        phone,
        message,
        image,
      });
      sendResponse(res, 200, data, "Mensaje enviado");
    } catch (err) {
      sendResponse(res, 400, null, err.message);
    }
  },

  /** POST /organizations/:id/wa/restart { clientId? } */
  restart: async (req, res) => {
    try {
      const orgId = req.params.id;
      const { clientId } = req.body || {};
      const data = await waIntegrationService.restart({ orgId, clientId });
      sendResponse(res, 200, data, "Sesión reiniciándose");
    } catch (err) {
      sendResponse(res, 400, null, err.message);
    }
  },

  /** POST /organizations/:id/wa/logout { clientId? } */
  logout: async (req, res) => {
    try {
      const orgId = req.params.id;
      const { clientId } = req.body || {};
      const data = await waIntegrationService.logout({ orgId, clientId });
      sendResponse(res, 200, data, "Sesión cerrada");
    } catch (err) {
      sendResponse(res, 400, null, err.message);
    }
  },
};

export default waController;
