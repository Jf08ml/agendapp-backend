import Client from "../models/clientModel.js";
import Organization from "../models/organizationModel.js";
import { normalizePhoneNumber } from "../utils/phoneUtils.js";

const clientService = {
  // Crear un nuevo cliente
  createClient: async (clientData) => {
    const { name, email, phoneNumber, organizationId, birthDate } = clientData;

    // 🌍 Obtener país por defecto de la organización
    const org = await Organization.findById(organizationId).select('default_country');
    const defaultCountry = org?.default_country || 'CO';

    // 🌍 Normalizar teléfono a E.164
    const phoneResult = normalizePhoneNumber(phoneNumber, defaultCountry);
    if (!phoneResult.isValid) {
      throw new Error(phoneResult.error);
    }

    // Crear y guardar el nuevo cliente (índice único previene duplicados)
    const newClient = new Client({
      name,
      email,
      phoneNumber, // Mantener original para retrocompatibilidad
      phone_e164: phoneResult.phone_e164,
      phone_country: phoneResult.phone_country,
      organizationId,
      birthDate,
    });
    
    try {
      return await newClient.save();
    } catch (error) {
      // Capturar error de duplicado del índice único de MongoDB
      if (error.code === 11000) {
        throw new Error('Ya existe un cliente con este número de teléfono en esta organización');
      }
      throw error;
    }
  },

  // Obtener todos los clientes
  getClients: async () => {
    return await Client.find();
  },

  // Obtener clientes por organizationId
  getClientsByOrganizationId: async (organizationId) => {
    return await Client.find({ organizationId });
  },

  // 🚀 Búsqueda optimizada de clientes con filtros y paginación
  searchClients: async (organizationId, searchQuery = "", limit = 20) => {
    const query = { organizationId };
    
    // Si hay búsqueda, agregar filtro por nombre, teléfono original o E.164
    if (searchQuery) {
      query.$or = [
        { name: { $regex: searchQuery, $options: "i" } },
        { phoneNumber: { $regex: searchQuery, $options: "i" } },
        { phone_e164: { $regex: searchQuery, $options: "i" } }, // 🌍 Buscar también por E.164
      ];
    }

    return await Client.find(query)
      .limit(limit)
      .select("_id name phoneNumber phone_e164 phone_country email birthDate")
      .sort({ name: 1 })
      .lean();
  },

  // Obtener un cliente por ID
  getClientById: async (id) => {
    const client = await Client.findById(id);
    if (!client) {
      throw new Error("Cliente no encontrado");
    }
    return client;
  },

  // Obtener un cliente por número de teléfono y organización
  getClientByPhoneNumberAndOrganization: async (
    phoneNumber,
    organizationId
  ) => {
    // 🌍 Buscar por phoneNumber original O por phone_e164
    const client = await Client.findOne({ 
      $or: [
        { phoneNumber, organizationId },
        { phone_e164: phoneNumber, organizationId }
      ]
    })
      .populate("organizationId")
      .exec();
    if (!client) {
      throw new Error("Cliente no encontrado");
    }
    return client;
  },

  // Actualizar un cliente
  updateClient: async (id, clientData) => {
    const { name, email, phoneNumber, organizationId, birthDate } = clientData;
    const client = await Client.findById(id);

    if (!client) {
      throw new Error("Cliente no encontrado");
    }

    // 🌍 Si se actualiza el teléfono, normalizar a E.164
    if (phoneNumber !== undefined && phoneNumber !== client.phoneNumber) {
      const org = await Organization.findById(client.organizationId).select('default_country');
      const defaultCountry = org?.default_country || 'CO';
      
      const phoneResult = normalizePhoneNumber(phoneNumber, defaultCountry);
      if (!phoneResult.isValid) {
        throw new Error(phoneResult.error);
      }

      // Actualizar campos de teléfono (índice único previene duplicados)
      client.phoneNumber = phoneNumber;
      client.phone_e164 = phoneResult.phone_e164;
      client.phone_country = phoneResult.phone_country;
    }

    // Actualizar solo si los valores existen o son null explícitos
    client.name = name !== undefined ? name : client.name;
    client.email = email !== undefined ? email : client.email;
    client.organizationId =
      organizationId !== undefined ? organizationId : client.organizationId;

    // Permitir que birthDate sea null
    client.birthDate = birthDate !== undefined ? birthDate : client.birthDate;

    try {
      return await client.save();
    } catch (error) {
      // Capturar error de duplicado del índice único de MongoDB
      if (error.code === 11000) {
        throw new Error('Ya existe otro cliente con este número de teléfono en esta organización');
      }
      throw error;
    }
  },

  // Eliminar un cliente
  deleteClient: async (id) => {
    const client = await Client.findById(id);
    if (!client) {
      throw new Error("Cliente no encontrado");
    }

    await Client.deleteOne({ _id: id });
    return { message: "Cliente eliminado correctamente" };
  },

  // Registrar un servicio para un cliente
  registerService: async (id) => {
    const client = await Client.findById(id);
    if (!client) {
      throw new Error("Cliente no encontrado");
    }
    return await client.incrementServices();
  },

  // Registrar un referido para un cliente
  registerReferral: async (id) => {
    const client = await Client.findById(id);
    if (!client) {
      throw new Error("Cliente no encontrado");
    }
    return await client.incrementReferrals();
  },
};

export default clientService;
