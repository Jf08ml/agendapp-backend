import appointmentService from "../services/appointmentService.js";
import clientService from "../services/clientService.js";
import sendResponse from "../utils/sendResponse.js";

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
      const result = await clientService.deleteClient(id);
      sendResponse(res, 200, null, clientHaveAppointments);
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para registrar un servicio a un cliente
  registerService: async (req, res) => {
    const { id } = req.params;
    try {
      const client = await clientService.registerService(id);
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
      const client = await clientService.registerReferral(id);
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
