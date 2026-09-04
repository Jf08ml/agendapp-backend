import sessionService from "../services/sessionService.js";
import sendResponse from "../utils/sendResponse.js";

const sessionController = {
  listSessions: async (req, res) => {
    try {
      const sessions = await sessionService.listActiveSessions(req.params.id);
      sendResponse(res, 200, sessions, "Sesiones activas obtenidas");
    } catch (error) {
      console.error("[sessionController.listSessions] Error:", error);
      sendResponse(res, 500, null, "Error al obtener las sesiones activas");
    }
  },

  revokeSession: async (req, res) => {
    try {
      const session = await sessionService.revokeSession(
        req.params.id,
        req.params.sessionId
      );
      if (!session) {
        return sendResponse(res, 404, null, "La sesión ya no existe o ya estaba cerrada");
      }
      sendResponse(res, 200, session, "Sesión cerrada exitosamente");
    } catch (error) {
      console.error("[sessionController.revokeSession] Error:", error);
      sendResponse(res, 500, null, "Error al cerrar la sesión");
    }
  },
};

export default sessionController;
