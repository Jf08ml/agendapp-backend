import planService from "../services/planService.js";
import sendResponse from "../utils/sendResponse.js";

const planController = {
  // Crear un nuevo plan
  createPlan: async (req, res) => {
    try {
      const newPlan = await planService.createPlan(req.body);
      sendResponse(res, 201, newPlan, "Plan creado exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Obtener todos los planes
  getPlans: async (req, res) => {
    try {
      const plans = await planService.getPlans();
      sendResponse(res, 200, plans, "Planes obtenidos exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Obtener un plan por ID
  getPlanById: async (req, res) => {
    const { id } = req.params;
    try {
      const plan = await planService.getPlanById(id);
      sendResponse(res, 200, plan, "Plan encontrado");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Actualizar un plan
  updatePlan: async (req, res) => {
    const { id } = req.params;
    try {
      const updatedPlan = await planService.updatePlan(id, req.body);
      sendResponse(res, 200, updatedPlan, "Plan actualizado exitosamente");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Eliminar un plan
  deletePlan: async (req, res) => {
    const { id } = req.params;
    try {
      await planService.deletePlan(id);
      sendResponse(res, 200, null, "Plan eliminado correctamente");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },
};

export default planController;
