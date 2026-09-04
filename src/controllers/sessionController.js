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

  // Ping liviano usado por el frontend (useSessionExpiry) para detectar en
  // segundo plano (pestaña idle / PWA) que la sesión fue revocada, sin esperar
  // a que una request "real" dispare el 401. verifyToken ya rechazó la request
  // con 401 si el token trae `sid` y esa sesión está revocada — llegar hasta acá
  // significa que sigue viva (o que es un token legacy sin `sid` todavía).
  checkCurrent: (req, res) => {
    sendResponse(res, 200, { hasSid: !!req.user.sid }, "Sesión vigente");
  },
};

export default sessionController;
