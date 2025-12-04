import Client from "../models/clientModel.js";

const clientService = {
  // Crear un nuevo cliente
  createClient: async (clientData) => {
    const { name, email, phoneNumber, organizationId, birthDate } = clientData;

    // Crear y guardar el nuevo cliente
    const newClient = new Client({
      name,
      email,
      phoneNumber,
      organizationId,
      birthDate,
    });
    return await newClient.save();
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
    
    // Si hay búsqueda, agregar filtro por nombre o teléfono
    if (searchQuery) {
      query.$or = [
        { name: { $regex: searchQuery, $options: "i" } },
        { phoneNumber: { $regex: searchQuery, $options: "i" } },
      ];
    }

    return await Client.find(query)
      .limit(limit)
      .select("_id name phoneNumber email birthDate")
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
    const client = await Client.findOne({ phoneNumber, organizationId })
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

    // Actualizar solo si los valores existen o son null explícitos
    client.name = name !== undefined ? name : client.name;
    client.email = email !== undefined ? email : client.email;
    client.phoneNumber =
      phoneNumber !== undefined ? phoneNumber : client.phoneNumber;
    client.organizationId =
      organizationId !== undefined ? organizationId : client.organizationId;

    // Permitir que birthDate sea null
    client.birthDate = birthDate !== undefined ? birthDate : client.birthDate;

    return await client.save();
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
