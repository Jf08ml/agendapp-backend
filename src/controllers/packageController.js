import packageService from "../services/packageService.js";
import sendResponse from "../utils/sendResponse.js";
import membershipService from "../services/membershipService.js";

const packageController = {
  // =============================================
  // CRUD - ServicePackage (plantillas)
  // =============================================

  createServicePackage: async (req, res) => {
    try {
      const organizationId = req.organization?._id || req.body.organizationId;
      const limits = await membershipService.getPlanLimits(organizationId);
      if (!limits?.servicePackages) {
        return sendResponse(res, 403, null,
          "Los paquetes de sesiones requieren el Plan Marca/Pro.",
          { reason: "plan_limit_packages" }
        );
      }
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

  permanentlyDeleteServicePackage: async (req, res) => {
    try {
      const { organizationId } = req.body;
      const result = await packageService.permanentlyDeleteServicePackage(
        req.params.id,
        organizationId
      );
      sendResponse(res, 200, null, result.message);
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  forceDeleteServicePackage: async (req, res) => {
    try {
      const { organizationId } = req.body;
      const result = await packageService.forceDeleteServicePackage(
        req.params.id,
        organizationId
      );
      sendResponse(res, 200, result.deleted, result.message);
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  // =============================================
  // ClientPackage (asignación y consulta)
  // =============================================

  assignPackageToClient: async (req, res) => {
    try {
      const { servicePackageId, clientId, organizationId, paymentMethod, paymentNotes, purchaseDate, tierId } = req.body;
      const result = await packageService.assignPackageToClient(
        servicePackageId,
        clientId,
        organizationId,
        { paymentMethod, paymentNotes, purchaseDate, tierId }
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

  // 📚 Paquetes activos del cliente con créditos para una clase
  getActivePackagesForClass: async (req, res) => {
    try {
      const { clientId, classId } = req.params;
      const { organizationId } = req.query;
      const result = await packageService.getActivePackagesForClass(
        clientId,
        classId,
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

  getAllOrgClientPackages: async (req, res) => {
    try {
      const { organizationId } = req.params;
      const { status = "" } = req.query;
      const result = await packageService.getAllOrgClientPackages(organizationId, { status });
      sendResponse(res, 200, result, "Paquetes asignados obtenidos exitosamente");
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

  // Público: verificar paquetes de SERVICIO por el identificador configurado
  checkClientPackagesByIdentifierPublic: async (req, res) => {
    try {
      const { field, value, serviceIds, organizationId } = req.query;
      if (!field || !value || !serviceIds || !organizationId) {
        return sendResponse(res, 400, null, "Faltan parámetros: field, value, serviceIds, organizationId");
      }
      const serviceIdArray = Array.isArray(serviceIds) ? serviceIds : serviceIds.split(",");
      const result = await packageService.checkClientPackagesByIdentifier(
        field,
        value,
        serviceIdArray,
        organizationId
      );
      sendResponse(res, 200, result, "Verificación de paquetes completada");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // 📚 Público: verificar paquetes con créditos de clase por teléfono
  checkClientClassPackagesPublic: async (req, res) => {
    try {
      const { phone, classIds, organizationId } = req.query;
      if (!phone || !classIds || !organizationId) {
        return sendResponse(res, 400, null, "Faltan parámetros: phone, classIds, organizationId");
      }
      const classIdArray = Array.isArray(classIds) ? classIds : classIds.split(",");
      const result = await packageService.checkClientClassPackagesByPhone(
        phone,
        classIdArray,
        organizationId
      );
      sendResponse(res, 200, result, "Verificación de paquetes de clase completada");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // 📚 Público: verificar paquetes de clase por el identificador configurado
  checkClientClassPackagesByIdentifierPublic: async (req, res) => {
    try {
      const { field, value, classIds, organizationId } = req.query;
      if (!field || !value || !classIds || !organizationId) {
        return sendResponse(res, 400, null, "Faltan parámetros: field, value, classIds, organizationId");
      }
      const classIdArray = Array.isArray(classIds) ? classIds : classIds.split(",");
      const result = await packageService.checkClientClassPackagesByIdentifier(
        field,
        value,
        classIdArray,
        organizationId
      );
      sendResponse(res, 200, result, "Verificación de paquetes de clase completada");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // 💰 Registrar un pago para un paquete de cliente
  addPayment: async (req, res) => {
    try {
      const { id } = req.params;
      const { amount, method, date, note } = req.body;
      if (!amount || amount <= 0) {
        return sendResponse(res, 400, null, 'El monto del pago debe ser mayor a 0');
      }
      const registeredBy = req.user?._id || req.user?.id || undefined;
      const pkg = await packageService.addPaymentToPackage(id, { amount, method, date, note, registeredBy });
      sendResponse(res, 200, pkg, 'Pago registrado correctamente');
    } catch (error) {
      console.error('Error en addPayment (package):', error);
      sendResponse(res, error.statusCode || 500, null, error.message);
    }
  },

  // 💰 Eliminar un pago de un paquete de cliente
  removePayment: async (req, res) => {
    try {
      const { id, paymentId } = req.params;
      const pkg = await packageService.removePaymentFromPackage(id, paymentId);
      sendResponse(res, 200, pkg, 'Pago eliminado correctamente');
    } catch (error) {
      console.error('Error en removePayment (package):', error);
      sendResponse(res, error.statusCode || 500, null, error.message);
    }
  },
};

export default packageController;
