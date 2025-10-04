// controllers/reminderController.js
import { reminderService } from "../services/reminderService.js";
import sendResponse from "../utils/sendResponse.js";

const reminderController = {
  /** POST /organizations/:id/wa/reminders  body: { dryRun?: boolean } */
  sendForOrganization: async (req, res) => {
    try {
      const orgId = req.params.id;
      const { dryRun = false } = req.body || {};
      const r = await reminderService.sendDailyRemindersViaCampaign({
        orgId,
        dryRun,
      });
      return sendResponse(
        res,
        200,
        r,
        dryRun ? "Previsualización generada" : "Campaña creada"
      );
    } catch (e) {
      return sendResponse(
        res,
        500,
        null,
        e.message || "Error enviando recordatorios"
      );
    }
  },

  /** POST /wa/reminders  body: { dryRun?: boolean }  (opcional: todas las organizaciones) */
  sendAll: async (req, res) => {
    try {
      const { dryRun = false } = req.body || {};
      const r = await reminderService.sendDailyRemindersViaCampaign({ dryRun });
      return sendResponse(
        res,
        200,
        r,
        dryRun ? "Previsualización generada" : "Campañas creadas"
      );
    } catch (e) {
      return sendResponse(
        res,
        500,
        null,
        e.message || "Error enviando recordatorios"
      );
    }
  },
};

export default reminderController;
