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

  /**
   * POST /api/public/cancel/confirm
   * Confirma una o varias citas usando el token público
   * Body: { token, appointmentIds?: string[] }
   */
  confirmByToken: async (req, res) => {
    try {
      const { token, appointmentIds } = req.body;

      if (!token) {
        return sendResponse(res, 400, null, 'Token requerido');
      }

      const result = await cancellationService.confirmByToken(token, appointmentIds);

      if (!result.success) {
        return sendResponse(res, 400, null, result.message);
      }

      return sendResponse(res, 200, result.data, result.message);
    } catch (error) {
      console.error('[confirmByToken] Error:', error);
      return sendResponse(res, 500, null, 'Error al confirmar la cita');
    }
  },
  /** GET /api/public/cancel/reschedule-info?token=XYZ — ¿se puede reagendar y con qué reglas? */
  getRescheduleInfo: async (req, res) => {
    try {
      const result = await cancellationService.getRescheduleInfo(req.query.token);
      if (!result.success) return sendResponse(res, 400, null, result.message);
      return sendResponse(res, 200, result.data, 'Información de reagendamiento');
    } catch (error) {
      console.error('[getRescheduleInfo] Error:', error);
      return sendResponse(res, 500, null, 'Error al consultar el reagendamiento');
    }
  },

  /** POST /api/public/cancel/reschedule/slots — Body: { token, date: "YYYY-MM-DD" } */
  getRescheduleSlots: async (req, res) => {
    try {
      const { token, date } = req.body;
      const result = await cancellationService.getRescheduleSlots(token, date);
      if (!result.success) return sendResponse(res, 400, null, result.message);
      return sendResponse(res, 200, result.data, 'Horarios disponibles');
    } catch (error) {
      console.error('[getRescheduleSlots] Error:', error);
      return sendResponse(res, 500, null, 'Error al obtener los horarios');
    }
  },

  /** POST /api/public/cancel/reschedule — Body: { token, newStartDate: ISO } */
  rescheduleByToken: async (req, res) => {
    try {
      const { token, newStartDate } = req.body;
      if (!token || !newStartDate) return sendResponse(res, 400, null, 'Token y nuevo horario requeridos');
      const result = await cancellationService.rescheduleByToken(token, newStartDate);
      if (!result.success) return sendResponse(res, 400, null, result.message);
      return sendResponse(res, 200, result.data, result.message);
    } catch (error) {
      console.error('[rescheduleByToken] Error:', error);
      return sendResponse(res, 500, null, 'Error al reagendar la cita');
    }
  },
};

export default publicCancellationController;
