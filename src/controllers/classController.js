// src/controllers/classController.js
import { roomService, classTypeService, sessionService } from "../services/classService.js";
import sendResponse from "../utils/sendResponse.js";

// ══════════════════════════════════════════════════════
// SALONES
// ══════════════════════════════════════════════════════

const roomController = {
  create: async (req, res) => {
    try {
      const organizationId = req.organization._id;
      const room = await roomService.create(organizationId, req.body);
      sendResponse(res, 201, room, "Salón creado exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  getByOrganization: async (req, res) => {
    try {
      const organizationId = req.params.organizationId || req.organization?._id;
      const rooms = await roomService.getByOrganization(organizationId);
      sendResponse(res, 200, rooms, "Salones obtenidos exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  getById: async (req, res) => {
    try {
      const room = await roomService.getById(req.params.id);
      sendResponse(res, 200, room, "Salón encontrado");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  update: async (req, res) => {
    try {
      const room = await roomService.update(req.params.id, req.body);
      sendResponse(res, 200, room, "Salón actualizado exitosamente");
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  delete: async (req, res) => {
    try {
      const result = await roomService.delete(req.params.id);
      sendResponse(res, 200, null, result.message);
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },
};

// ══════════════════════════════════════════════════════
// CLASES (tipos)
// ══════════════════════════════════════════════════════

const classController = {
  create: async (req, res) => {
    try {
      const organizationId = req.organization._id;
      const classDoc = await classTypeService.create(organizationId, req.body);
      sendResponse(res, 201, classDoc, "Clase creada exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  getByOrganization: async (req, res) => {
    try {
      const organizationId = req.params.organizationId || req.organization?._id;
      const includeInactive = req.query.includeInactive === "true";
      const classes = await classTypeService.getByOrganization(organizationId, { includeInactive });
      sendResponse(res, 200, classes, "Clases obtenidas exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  getById: async (req, res) => {
    try {
      const classDoc = await classTypeService.getById(req.params.id);
      sendResponse(res, 200, classDoc, "Clase encontrada");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  update: async (req, res) => {
    try {
      const classDoc = await classTypeService.update(req.params.id, req.body);
      sendResponse(res, 200, classDoc, "Clase actualizada exitosamente");
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  delete: async (req, res) => {
    try {
      const result = await classTypeService.delete(req.params.id);
      sendResponse(res, 200, null, result.message);
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },
};

// ══════════════════════════════════════════════════════
// SESIONES
// ══════════════════════════════════════════════════════

const sessionController = {
  create: async (req, res) => {
    try {
      const organizationId = req.organization._id;
      const session = await sessionService.create(organizationId, req.body);
      const populated = await sessionService.getById(session._id);
      sendResponse(res, 201, populated, "Sesión creada exitosamente");
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  getByOrganization: async (req, res) => {
    try {
      const organizationId = req.organization._id;
      const { from, to, classId, employeeId, roomId, status } = req.query;
      const sessions = await sessionService.getByOrganization(organizationId, {
        from,
        to,
        classId,
        employeeId,
        roomId,
        status,
      });
      sendResponse(res, 200, sessions, "Sesiones obtenidas exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // 🌐 Público: sesiones disponibles para reserva online
  getAvailable: async (req, res) => {
    try {
      const { organizationId, classId, from, to } = req.query;
      if (!organizationId) {
        return sendResponse(res, 400, null, "Se requiere organizationId");
      }
      const sessions = await sessionService.getAvailable(organizationId, { classId, from, to });
      sendResponse(res, 200, sessions, "Sesiones disponibles obtenidas exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  getById: async (req, res) => {
    try {
      const session = await sessionService.getById(req.params.id);
      sendResponse(res, 200, session, "Sesión encontrada");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  update: async (req, res) => {
    try {
      const session = await sessionService.update(req.params.id, req.body);
      const populated = await sessionService.getById(session._id);
      sendResponse(res, 200, populated, "Sesión actualizada exitosamente");
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  delete: async (req, res) => {
    try {
      const result = await sessionService.deleteSession(req.params.id);
      sendResponse(res, 200, null, result.message);
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  bulkDelete: async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return sendResponse(res, 400, null, "Se requiere un array de ids");
      }
      const result = await sessionService.deleteSessions(ids);
      sendResponse(res, 200, null, `${result.deleted} sesión(es) eliminada(s)`);
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  cancel: async (req, res) => {
    try {
      await sessionService.cancel(req.params.id);
      sendResponse(res, 200, null, "Sesión cancelada exitosamente");
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  markCompleted: async (req, res) => {
    try {
      const session = await sessionService.markCompleted(req.params.id);
      sendResponse(res, 200, session, "Sesión marcada como completada");
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  bulkCreate: async (req, res) => {
    try {
      const organizationId = req.organization._id;
      const org = req.organization;

      // Inyectar timezone de la organización si no viene en el body
      const timezone = req.body.timezone || org.timezone || "America/Bogota";

      const result = await sessionService.bulkCreate(organizationId, {
        ...req.body,
        timezone,
      });

      const message = `${result.created.length} sesión(es) creada(s)${
        result.skipped.length ? `, ${result.skipped.length} omitida(s) por conflicto de horario` : ""
      }`;
      sendResponse(res, 201, result, message);
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },
};

export { roomController, classController, sessionController };
