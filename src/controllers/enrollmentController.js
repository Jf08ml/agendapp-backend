// src/controllers/enrollmentController.js
import enrollmentService from "../services/enrollmentService.js";
import sendResponse from "../utils/sendResponse.js";

const enrollmentController = {
  // 🌐 Público: cliente reserva desde la web
  createPublic: async (req, res) => {
    try {
      const { organizationId, sessionId, attendee, companion, notes } = req.body;
      if (!organizationId || !sessionId || !attendee) {
        return sendResponse(res, 400, null, "organizationId, sessionId y attendee son requeridos");
      }
      const enrollments = await enrollmentService.createPublicEnrollments({
        organizationId,
        sessionId,
        attendee,
        companion,
        notes,
      });
      // Incluir el cancelToken en la respuesta (solo en creación, no se almacena en claro)
      const response = enrollments.map((e) => ({
        ...e.toObject(),
        cancelToken: e._cancelToken,
      }));
      sendResponse(res, 201, response, "Inscripción creada exitosamente");
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  // 🔒 Admin: crea inscripción(es) directamente (siempre confirmadas)
  adminCreate: async (req, res) => {
    try {
      const organizationId = req.organization._id;
      const { sessionId, attendees, applyDiscount, notes } = req.body;
      if (!sessionId || !attendees?.length) {
        return sendResponse(res, 400, null, "sessionId y attendees son requeridos");
      }
      const enrollments = await enrollmentService.adminCreateEnrollments({
        organizationId,
        sessionId,
        attendees,
        applyDiscount,
        notes,
      });
      sendResponse(res, 201, enrollments, "Inscripción(es) creada(s) exitosamente");
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  // 🔒 Admin: obtiene inscripciones de la organización con filtros
  getByOrganization: async (req, res) => {
    try {
      const organizationId = req.organization._id;
      const { status, sessionId, classId, from, to, page, limit } = req.query;
      const result = await enrollmentService.getOrganizationEnrollments(organizationId, {
        status,
        sessionId,
        classId,
        from,
        to,
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 50,
      });
      sendResponse(res, 200, result, "Inscripciones obtenidas exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // 🔒 Admin: inscripciones de una sesión específica
  getBySession: async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { status } = req.query;
      const enrollments = await enrollmentService.getSessionEnrollments(sessionId, { status });
      sendResponse(res, 200, enrollments, "Inscripciones de la sesión obtenidas exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // 🔒 Admin: aprobar inscripción pendiente
  approve: async (req, res) => {
    try {
      const approved = await enrollmentService.approveEnrollment(req.params.id);
      sendResponse(res, 200, approved, "Inscripción aprobada exitosamente");
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  // 🔒 Admin: cancelar inscripción
  cancel: async (req, res) => {
    try {
      const enrollment = await enrollmentService.cancelEnrollment(req.params.id, "admin");
      sendResponse(res, 200, enrollment, "Inscripción cancelada exitosamente");
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  // 🔒 Admin: marcar asistencia (attended / no_show)
  updateAttendance: async (req, res) => {
    try {
      const { status } = req.body;
      const enrollment = await enrollmentService.updateAttendanceStatus(req.params.id, status);
      sendResponse(res, 200, enrollment, "Estado de asistencia actualizado");
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  // 🔒 Admin: registrar pago de una inscripción
  addPayment: async (req, res) => {
    try {
      const enrollment = await enrollmentService.addPayment(req.params.id, req.body);
      sendResponse(res, 200, enrollment, "Pago registrado exitosamente");
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },
};

export default enrollmentController;
