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
      phoneNumber: phoneResult.phone_national_clean, // 🆕 Solo dígitos locales, sin espacios ni guiones
      phone_e164: phoneResult.phone_e164, // Con código de país en formato E.164
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

    const org = await Organization.findById(client.organizationId).select('default_country');
    const defaultCountry = org?.default_country || 'CO';

    // 🔄 MIGRACIÓN AUTOMÁTICA: Si el cliente no tiene phone_e164, normalizar el número actual
    if (!client.phone_e164 && client.phoneNumber) {
      console.log(`[updateClient] Migrando cliente ${id} al nuevo schema de teléfonos`);
      const phoneResult = normalizePhoneNumber(client.phoneNumber, defaultCountry);
      if (phoneResult.isValid) {
        client.phoneNumber = phoneResult.phone_national_clean;
        client.phone_e164 = phoneResult.phone_e164;
        client.phone_country = phoneResult.phone_country;
        console.log(`[updateClient] Migración exitosa: ${client.phoneNumber} -> ${client.phone_e164}`);
      }
    }

    // 🌍 Si se actualiza el teléfono, normalizar a E.164
    if (phoneNumber !== undefined && phoneNumber !== client.phoneNumber) {
      const phoneResult = normalizePhoneNumber(phoneNumber, defaultCountry);
      if (!phoneResult.isValid) {
        throw new Error(phoneResult.error);
      }

      // Actualizar campos de teléfono (índice único previene duplicados)
      client.phoneNumber = phoneResult.phone_national_clean; // 🆕 Solo dígitos locales
      client.phone_e164 = phoneResult.phone_e164; // Con código de país
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

  // Carga masiva de clientes desde Excel
  bulkCreateClients: async (clientsData, organizationId) => {
    const results = {
      success: [],
      errors: [],
      totalProcessed: 0,
      totalSuccess: 0,
      totalErrors: 0
    };

    // Obtener país por defecto de la organización
    const org = await Organization.findById(organizationId).select('default_country');
    const defaultCountry = org?.default_country || 'CO';

    console.log(`[bulkCreateClients] Procesando ${clientsData.length} clientes para organización ${organizationId}, país: ${defaultCountry}`);

    for (let i = 0; i < clientsData.length; i++) {
      const row = clientsData[i];
      results.totalProcessed++;

      try {
        // Validar datos requeridos
        if (!row.name || !row.phoneNumber) {
          throw new Error('Nombre y teléfono son obligatorios');
        }

        // Limpiar el número de teléfono antes de normalizar
        const cleanPhoneNumber = String(row.phoneNumber).trim();
        
        console.log(`[bulkCreateClients] Fila ${i + 2}: Procesando ${row.name}, teléfono: ${cleanPhoneNumber}`);

        // Normalizar teléfono a E.164
        const phoneResult = normalizePhoneNumber(cleanPhoneNumber, defaultCountry);
        
        console.log(`[bulkCreateClients] Fila ${i + 2}: Resultado normalización:`, phoneResult);
        
        if (!phoneResult.isValid) {
          throw new Error(phoneResult.error || 'Número de teléfono inválido');
        }

        // Crear cliente
        const newClient = new Client({
          name: row.name.trim(),
          email: row.email ? row.email.trim() : undefined,
          phoneNumber: phoneResult.phone_national_clean, // 🆕 Solo dígitos locales
          phone_e164: phoneResult.phone_e164, // Con código de país
          phone_country: phoneResult.phone_country,
          organizationId,
          birthDate: row.birthDate || null,
        });

        const savedClient = await newClient.save();
        results.success.push({
          row: i + 2, // +2 porque la primera fila es encabezado y Excel empieza en 1
          name: savedClient.name,
          phoneNumber: savedClient.phoneNumber
        });
        results.totalSuccess++;

      } catch (error) {
        let errorMessage = error.message;
        
        // Mejorar mensaje de error de duplicado
        if (error.code === 11000) {
          errorMessage = 'Cliente duplicado - Ya existe con este número de teléfono';
        }

        console.error(`[bulkCreateClients] Fila ${i + 2}: Error - ${errorMessage}`);

        results.errors.push({
          row: i + 2,
          name: row.name || 'Sin nombre',
          phoneNumber: row.phoneNumber || 'Sin teléfono',
          error: errorMessage
        });
        results.totalErrors++;
      }
    }

    console.log(`[bulkCreateClients] Completado: ${results.totalSuccess} éxitos, ${results.totalErrors} errores`);
    return results;
  },
};

export default clientService;
