import serviceService from "../services/serviceService.js";
import sendResponse from "../utils/sendResponse.js";

const serviceController = {
  // Crear un nuevo servicio
  createService: async (req, res) => {
    try {
      const newService = await serviceService.createService(req.body);
      sendResponse(res, 201, newService, "Servicio creado exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Obtener todos los servicios
  getServices: async (req, res) => {
    try {
      const services = await serviceService.getServices();
      sendResponse(res, 200, services, "Servicios obtenidos exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Obtener servicios por organizationId
  getServicesByOrganizationId: async (req, res) => {
    const { organizationId } = req.params;
    try {
      const services = await serviceService.getServicesByOrganizationId(
        organizationId
      );
      sendResponse(
        res,
        200,
        services,
        "Servicios de la organización obtenidos exitosamente"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Obtener un servicio por ID
  getServiceById: async (req, res) => {
    try {
      const service = await serviceService.getServiceById(req.params.id);
      sendResponse(res, 200, service, "Servicio encontrado");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Actualizar un servicio
  updateService: async (req, res) => {
    try {
      const updatedService = await serviceService.updateService(
        req.params.id,
        req.body
      );
      sendResponse(
        res,
        200,
        updatedService,
        "Servicio actualizado exitosamente"
      );
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Eliminar un servicio
  deleteService: async (req, res) => {
    try {
      const result = await serviceService.deleteService(req.params.id);
      sendResponse(res, 200, null, result.message);
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para carga masiva de servicios desde Excel
  bulkUploadServices: async (req, res) => {
    try {
      const { services, organizationId } = req.body;

      if (!services || !Array.isArray(services) || services.length === 0) {
        return sendResponse(res, 400, null, "No se proporcionaron datos de servicios");
      }

      if (!organizationId) {
        return sendResponse(res, 400, null, "Se requiere el ID de la organización");
      }

      const results = await serviceService.bulkCreateServices(services, organizationId);
      
      sendResponse(
        res,
        200,
        results,
        `Proceso completado: ${results.totalSuccess} éxitos, ${results.totalErrors} errores`
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },
};

export default serviceController;
