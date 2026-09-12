import advanceService from "../services/advanceService.js";
import sendResponse from "../utils/sendResponse.js";

const advanceController = {
  // Controlador para crear un nuevo avance (o ingreso manual)
  createAdvance: async (req, res) => {
    try {
      if (!req.organization) return sendResponse(res, 400, null, "Organización no identificada");
      const newAdvance = await advanceService.createAdvance(req.organization._id, req.body);
      sendResponse(res, 201, newAdvance, "Avance creado exitosamente");
    } catch (error) {
      sendResponse(res, error.message?.includes("no encontrado") ? 404 : 500, null, error.message);
    }
  },

  // Controlador para obtener los avances/ingresos de un empleado de la organización actual
  getAdvancesByEmployee: async (req, res) => {
    try {
      if (!req.organization) return sendResponse(res, 400, null, "Organización no identificada");
      const { employeeId } = req.params;
      const advances = await advanceService.getAdvancesByEmployee(
        req.organization._id,
        employeeId
      );
      sendResponse(
        res,
        200,
        advances,
        "Avances del empleado obtenidos exitosamente"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para actualizar un avance/ingreso
  updateAdvance: async (req, res) => {
    try {
      if (!req.organization) return sendResponse(res, 400, null, "Organización no identificada");
      const { id } = req.params;
      const updatedAdvance = await advanceService.updateAdvance(
        req.organization._id,
        id,
        req.body
      );
      sendResponse(res, 200, updatedAdvance, "Avance actualizado exitosamente");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para eliminar un avance/ingreso
  deleteAdvance: async (req, res) => {
    try {
      if (!req.organization) return sendResponse(res, 400, null, "Organización no identificada");
      const { id } = req.params;
      await advanceService.deleteAdvance(req.organization._id, id);
      sendResponse(res, 200, null, "Avance eliminado correctamente");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },
};

export default advanceController;
