import serviceService from "../services/serviceService.js";
import sendResponse from "../utils/sendResponse.js";
import membershipService from "../services/membershipService.js";
import Service from "../models/serviceModel.js";
import { resolveUserOrgId } from "../middleware/organizationAccess.js";
import { bulkOrganization } from "../utils/bulkServices.js";
import { canAccessService, editableServiceFields, listScope } from "../utils/serviceAccess.js";

// Servicio por id solo si es del negocio del usuario (superadmin: cualquiera).
// Si no, se responde igual que si no existiera.
async function findAccessibleService(req) {
  const service = await Service.findById(req.params.id).select("organizationId").lean();
  if (!service) return null;
  const userOrgId = await resolveUserOrgId(req.user);
  return canAccessService({ user: req.user, userOrgId, serviceOrgId: service.organizationId }) ? service : null;
}

const serviceController = {
  // Crear un nuevo servicio
  createService: async (req, res) => {
    try {
      // El negocio sale de la sesión (superadmin: el del body)
      const userOrgId = await resolveUserOrgId(req.user);
      const access = bulkOrganization({ user: req.user, userOrgId, bodyOrgId: req.body.organizationId });
      if (access.error) {
        return sendResponse(res, access.status, null, access.error);
      }
      const organizationId = access.orgId;
      const limits = await membershipService.getPlanLimits(organizationId);
      if (limits?.maxServices !== null && limits?.maxServices !== undefined) {
        const count = await Service.countDocuments({ organizationId });
        if (count >= limits.maxServices) {
          return sendResponse(res, 403, null,
            `Tu plan permite máximo ${limits.maxServices} servicio(s). Actualiza tu plan para agregar más.`,
            { reason: "plan_limit_services", limit: limits.maxServices }
          );
        }
      }
      const newService = await serviceService.createService({ ...req.body, organizationId });
      sendResponse(res, 201, newService, "Servicio creado exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Obtener todos los servicios
  getServices: async (req, res) => {
    try {
      const scope = listScope({ user: req.user, userOrgId: await resolveUserOrgId(req.user) });
      if (scope.deny) {
        return sendResponse(res, 403, null, "No tienes acceso a esta organización");
      }
      const services = scope.all
        ? await serviceService.getServices()
        : await serviceService.getServicesByOrganizationId(scope.orgId);
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
      if (!(await findAccessibleService(req))) {
        return sendResponse(res, 404, null, "Servicio no encontrado");
      }
      const service = await serviceService.getServiceById(req.params.id);
      sendResponse(res, 200, service, "Servicio encontrado");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Obtener un servicio por ID — versión pública (vista de detalle compartible)
  getPublicServiceById: async (req, res) => {
    try {
      const service = await serviceService.getPublicServiceById(
        req.params.id,
        req.query.organizationId
      );
      sendResponse(res, 200, service, "Servicio encontrado");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Actualizar un servicio
  updateService: async (req, res) => {
    try {
      if (!(await findAccessibleService(req))) {
        return sendResponse(res, 404, null, "Servicio no encontrado");
      }
      const updatedService = await serviceService.updateService(
        req.params.id,
        editableServiceFields(req.body)
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
      if (!(await findAccessibleService(req))) {
        return sendResponse(res, 404, null, "Servicio no encontrado");
      }
      const result = await serviceService.deleteService(req.params.id);
      sendResponse(res, 200, null, result.message);
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para carga masiva de servicios desde Excel
  bulkUploadServices: async (req, res) => {
    try {
      const { services, organizationId: bodyOrgId } = req.body;

      if (!services || !Array.isArray(services) || services.length === 0) {
        return sendResponse(res, 400, null, "No se proporcionaron datos de servicios");
      }

      // El negocio sale de la sesión (superadmin: el que indique el body)
      const userOrgId = await resolveUserOrgId(req.user);
      const access = bulkOrganization({ user: req.user, userOrgId, bodyOrgId });
      if (access.error) {
        return sendResponse(res, access.status, null, access.error);
      }

      const results = await serviceService.bulkCreateServices(services, access.orgId);
      
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
