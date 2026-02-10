import packageService from "../services/packageService.js";
import sendResponse from "../utils/sendResponse.js";

const packageController = {
  // =============================================
  // CRUD - ServicePackage (plantillas)
  // =============================================

  createServicePackage: async (req, res) => {
    try {
      const { organizationId } = req.body;
      const result = await packageService.createServicePackage(req.body, organizationId);
      sendResponse(res, 201, result, "Paquete creado exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  getServicePackages: async (req, res) => {
    try {
      const { organizationId } = req.params;
      const activeOnly = req.query.activeOnly === "true";
      const result = await packageService.getServicePackages(organizationId, { activeOnly });
      sendResponse(res, 200, result, "Paquetes obtenidos exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  getServicePackageById: async (req, res) => {
    try {
      const result = await packageService.getServicePackageById(req.params.id);
      if (!result) {
        return sendResponse(res, 404, null, "Paquete no encontrado");
      }
      sendResponse(res, 200, result, "Paquete obtenido exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  updateServicePackage: async (req, res) => {
    try {
      const { organizationId } = req.body;
      const result = await packageService.updateServicePackage(
        req.params.id,
        req.body,
        organizationId
      );
      if (!result) {
        return sendResponse(res, 404, null, "Paquete no encontrado");
      }
      sendResponse(res, 200, result, "Paquete actualizado exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  deleteServicePackage: async (req, res) => {
    try {
      const { organizationId } = req.body;
      const result = await packageService.deleteServicePackage(req.params.id, organizationId);
      if (!result) {
        return sendResponse(res, 404, null, "Paquete no encontrado");
      }
      sendResponse(res, 200, result, "Paquete desactivado exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // =============================================
  // ClientPackage (asignación y consulta)
  // =============================================

  assignPackageToClient: async (req, res) => {
    try {
      const { servicePackageId, clientId, organizationId, paymentMethod, paymentNotes, purchaseDate } = req.body;
      const result = await packageService.assignPackageToClient(
        servicePackageId,
        clientId,
        organizationId,
        { paymentMethod, paymentNotes, purchaseDate }
      );
      sendResponse(res, 201, result, "Paquete asignado al cliente exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  getClientPackages: async (req, res) => {
    try {
      const { clientId } = req.params;
      const { organizationId } = req.query;
      const result = await packageService.getClientPackages(clientId, organizationId);
      sendResponse(res, 200, result, "Paquetes del cliente obtenidos exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  getActivePackagesForService: async (req, res) => {
    try {
      const { clientId, serviceId } = req.params;
      const { organizationId } = req.query;
      const result = await packageService.getActivePackagesForService(
        clientId,
        serviceId,
        organizationId
      );
      sendResponse(res, 200, result, "Paquetes activos obtenidos exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  cancelClientPackage: async (req, res) => {
    try {
      const { id } = req.params;
      const { organizationId } = req.body;
      const result = await packageService.cancelClientPackage(id, organizationId);
      sendResponse(res, 200, result, "Paquete cancelado exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  deleteClientPackage: async (req, res) => {
    try {
      const { id } = req.params;
      const { organizationId } = req.body;
      const result = await packageService.deleteClientPackage(id, organizationId);
      sendResponse(res, 200, result, "Paquete eliminado exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // =============================================
  // Público (reserva online)
  // =============================================

  checkClientPackagesPublic: async (req, res) => {
    try {
      const { phone, serviceIds, organizationId } = req.query;
      if (!phone || !serviceIds || !organizationId) {
        return sendResponse(res, 400, null, "Faltan parámetros: phone, serviceIds, organizationId");
      }
      const serviceIdArray = Array.isArray(serviceIds) ? serviceIds : serviceIds.split(",");
      const result = await packageService.checkClientPackagesByPhone(
        phone,
        serviceIdArray,
        organizationId
      );
      sendResponse(res, 200, result, "Verificación de paquetes completada");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },
};

export default packageController;
