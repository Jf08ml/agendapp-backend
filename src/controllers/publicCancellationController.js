import cancellationService from '../services/cancellationService.js';
import sendResponse from '../utils/sendResponse.js';

const publicCancellationController = {
  /**
   * GET /api/public/cancel/info?token=XYZ
   * Obtiene información sobre lo que se puede cancelar con el token
   */
  getCancellationInfo: async (req, res) => {
    try {
      const { token } = req.query;

      if (!token) {
        return sendResponse(res, 400, null, 'Token requerido');
      }

      const info = await cancellationService.getCancellationInfo(token);

      if (!info.valid) {
        return sendResponse(res, 400, null, info.reason);
      }

      // Retornar toda la info incluyendo isGroup y appointments
      return sendResponse(res, 200, {
        ...info.data,
        isGroup: info.isGroup,
        appointments: info.appointments,
        type: info.type,
      }, 'Información obtenida exitosamente');
    } catch (error) {
      console.error('[getCancellationInfo] Error:', error);
      return sendResponse(res, 500, null, 'Error al obtener información de cancelación');
    }
  },

  /**
   * POST /api/public/cancel
   * Cancela una reserva/cita usando el token
   * Body: { token, reason?, appointmentIds?: string[] }
   */
  cancelByToken: async (req, res) => {
    try {
      const { token, reason, appointmentIds } = req.body;

      if (!token) {
        return sendResponse(res, 400, null, 'Token requerido');
      }

      const result = await cancellationService.cancelByToken(token, reason, appointmentIds);

      if (!result.success) {
        // Si ya está cancelado, devolver 200 (idempotente)
        if (result.alreadyCancelled) {
          return sendResponse(res, 200, null, result.message);
        }
        return sendResponse(res, 400, null, result.message);
      }

      return sendResponse(res, 200, result.data, result.message);
    } catch (error) {
      console.error('[cancelByToken] Error:', error);
      return sendResponse(res, 500, null, 'Error al procesar la cancelación');
    }
  },
};

export default publicCancellationController;
