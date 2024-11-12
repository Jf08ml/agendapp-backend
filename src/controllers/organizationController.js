import organizationService from "../services/organizationService.js";
import sendResponse from "../utils/sendResponse.js";

const organizationController = {
  // Controlador para crear una nueva organización
  createOrganization: async (req, res) => {
    try {
      const newOrganization = await organizationService.createOrganization(req.body);
      sendResponse(res, 201, newOrganization, "Organización creada exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para obtener todas las organizaciones
  getOrganizations: async (req, res) => {
    try {
      const organizations = await organizationService.getOrganizations();
      sendResponse(res, 200, organizations, "Organizaciones obtenidas exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para obtener una organización por ID
  getOrganizationById: async (req, res) => {
    const { id } = req.params;
    try {
      const organization = await organizationService.getOrganizationById(id);
      sendResponse(res, 200, organization, "Organización encontrada");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para actualizar una organización
  updateOrganization: async (req, res) => {
    const { id } = req.params;
    try {
      const updatedOrganization = await organizationService.updateOrganization(id, req.body);
      sendResponse(res, 200, updatedOrganization, "Organización actualizada exitosamente");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para eliminar una organización
  deleteOrganization: async (req, res) => {
    const { id } = req.params;
    try {
      const result = await organizationService.deleteOrganization(id);
      sendResponse(res, 200, null, result.message);
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },
};

export default organizationController;
