import appointmentService from "../services/appointmentService.js";
import clientService from "../services/clientService.js";
import sendResponse from "../utils/sendResponse.js";
import { auditLogService } from "../services/auditLogService.js";

const clientController = {
  // Controlador para crear un nuevo cliente
  createClient: async (req, res) => {
    try {
      const newClient = await clientService.createClient(req.body);
      sendResponse(res, 201, newClient, "Cliente creado exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para obtener todos los clientes
  getClients: async (req, res) => {
    try {
      const clients = await clientService.getClients();
      sendResponse(res, 200, clients, "Clientes obtenidos exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para obtener clientes por organizationId
  getClientsByOrganizationId: async (req, res) => {
    const { organizationId } = req.params;
    try {
      const clients = await clientService.getClientsByOrganizationId(
        organizationId
      );
      sendResponse(
        res,
        200,
        clients,
        "Clientes de la organización obtenidos exitosamente"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // 🚀 Controlador para búsqueda optimizada de clientes
  searchClients: async (req, res) => {
    const { organizationId } = req.params;
    const { search = "", limit = 20 } = req.query;
    try {
      const clients = await clientService.searchClients(
        organizationId,
        search,
        parseInt(limit)
      );
      sendResponse(
        res,
        200,
        clients,
        "Clientes encontrados exitosamente"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para obtener un cliente por ID
  getClientById: async (req, res) => {
    const { id } = req.params;
    try {
      const client = await clientService.getClientById(id);
      sendResponse(res, 200, client, "Cliente encontrado");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para obtener un cliente por número de teléfono
  getClientByPhoneNumberAndOrganization: async (req, res) => {
    const { phoneNumber, organizationId } = req.params;
    try {
      const client = await clientService.getClientByPhoneNumberAndOrganization(
        phoneNumber,
        organizationId
      );
      sendResponse(res, 200, client, "Cliente encontrado");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para buscar cliente por el campo identificador configurado
  getClientByIdentifier: async (req, res) => {
    const { field, value, organizationId } = req.query;
    if (!field || !value || !organizationId) {
      return sendResponse(res, 400, null, 'Parámetros requeridos: field, value, organizationId');
    }
    try {
      const client = await clientService.getClientByIdentifier(field, value, organizationId);
      if (!client) return sendResponse(res, 404, null, 'Cliente no encontrado');
      sendResponse(res, 200, client, 'Cliente encontrado');
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para actualizar un cliente
  updateClient: async (req, res) => {
    const { id } = req.params;
    try {
      const updatedClient = await clientService.updateClient(id, req.body);
      sendResponse(res, 200, updatedClient, "Cliente actualizado exitosamente");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para eliminar un cliente
  deleteClient: async (req, res) => {
    const { id } = req.params;

    const clientHaveAppointments =
      await appointmentService.getAppointmentsByClient(id);
    if (clientHaveAppointments.length > 0) {
      return sendResponse(
        res,
        400,
        null,
        "El cliente tiene citas, no se puede eliminar"
      );
    }
    try {
      const clientData = await clientService.getClientById(id);
      const result = await clientService.deleteClient(id);

      // 📋 Audit log
      await auditLogService.log({
        organizationId: clientData.organizationId,
        action: "delete_client",
        entityType: "client",
        entityId: id,
        entitySnapshot: auditLogService.snapshotClient(clientData),
        performedById: req.user?._id || req.user?.id || null,
        performedByName: req.user?.name || req.user?.email || "Admin",
        performedByRole: req.user?.role || null,
      });

      sendResponse(res, 200, null, clientHaveAppointments);
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para registrar un servicio a un cliente
  registerService: async (req, res) => {
    const { id } = req.params;
    try {
      const client = await clientService.registerService(id, req.organization);
      sendResponse(
        res,
        200,
        client,
        "Servicio registrado exitosamente para el cliente"
      );
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para registrar un referido a un cliente
  registerReferral: async (req, res) => {
    const { id } = req.params;
    try {
      const client = await clientService.registerReferral(id, req.organization);
      sendResponse(
        res,
        200,
        client,
        "Referido registrado exitosamente para el cliente"
      );
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para marcar una recompensa como canjeada
  redeemReward: async (req, res) => {
    const { id, rewardId } = req.params;
    try {
      const client = await clientService.redeemReward(id, rewardId);
      sendResponse(res, 200, client, "Recompensa marcada como canjeada");
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  // Controlador para fusionar cliente origen en cliente destino
  mergeClient: async (req, res) => {
    const { id, sourceId } = req.params;
    try {
      const client = await clientService.mergeClient(id, sourceId);
      sendResponse(res, 200, client, "Clientes fusionados correctamente");
    } catch (error) {
      sendResponse(res, 400, null, error.message);
    }
  },

  // Controlador para eliminar un cliente y todos sus registros
  forceDeleteClient: async (req, res) => {
    const { id } = req.params;
    try {
      const clientData = await clientService.getClientById(id);
      await clientService.forceDeleteClient(id);

      // 📋 Audit log
      await auditLogService.log({
        organizationId: clientData.organizationId,
        action: "force_delete_client",
        entityType: "client",
        entityId: id,
        entitySnapshot: auditLogService.snapshotClient(clientData),
        performedById: req.user?._id || req.user?.id || null,
        performedByName: req.user?.name || req.user?.email || "Admin",
        performedByRole: req.user?.role || null,
        metadata: { forced: true },
      });

      sendResponse(res, 200, null, "Cliente eliminado con todos sus registros");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para restablecer contadores de fidelidad de un cliente
  resetClientLoyalty: async (req, res) => {
    const { id } = req.params;
    try {
      const client = await clientService.resetClientLoyalty(id);
      sendResponse(res, 200, client, "Contadores del cliente restablecidos a 0");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para restablecer contadores de todos los clientes de la organización
  resetAllClientsLoyalty: async (req, res) => {
    try {
      const count = await clientService.resetAllClientsLoyalty(req.organization._id.toString());
      sendResponse(res, 200, { modifiedCount: count }, `${count} clientes restablecidos a 0`);
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para carga masiva de clientes desde Excel
  bulkUploadClients: async (req, res) => {
    try {
      const { clients, organizationId } = req.body;

      if (!clients || !Array.isArray(clients) || clients.length === 0) {
        return sendResponse(res, 400, null, "No se proporcionaron datos de clientes");
      }

      if (!organizationId) {
        return sendResponse(res, 400, null, "Se requiere el ID de la organización");
      }

      const results = await clientService.bulkCreateClients(clients, organizationId);
      
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

export default clientController;
