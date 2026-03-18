import Client from "../models/clientModel.js";
import Organization from "../models/organizationModel.js";
import WhatsappTemplate from "../models/whatsappTemplateModel.js";
import Appointment from "../models/appointmentModel.js";
import ClientPackage from "../models/clientPackageModel.js";
import Reservation from "../models/reservationModel.js";
import { normalizePhoneNumber } from "../utils/phoneUtils.js";
import whatsappTemplates from "../utils/whatsappTemplates.js";
import whatsappService from "./sendWhatsappService.js";

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
    const digitsOnly = phoneNumber.replace(/[^\d]/g, '');

    // Condiciones base: exacto en phoneNumber y phone_e164
    const orConditions = [
      { phoneNumber, organizationId },
      { phone_e164: phoneNumber, organizationId },
    ];

    if (digitsOnly && digitsOnly !== phoneNumber) {
      orConditions.push({ phoneNumber: digitsOnly, organizationId });
    }

    // Normalizar con el país por defecto de la organización para generar E.164 correcto
    // Ej: "3111234567" + país CO → "+573111234567"
    try {
      const org = await Organization.findById(organizationId).select('default_country');
      const defaultCountry = org?.default_country || 'CO';
      const phoneResult = normalizePhoneNumber(phoneNumber, defaultCountry);
      if (phoneResult.isValid && phoneResult.phone_e164) {
        orConditions.push({ phone_e164: phoneResult.phone_e164, organizationId });
        orConditions.push({ phoneNumber: phoneResult.phone_national_clean, organizationId });
      }
    } catch (_) {
      // Si falla la normalización, continuar con las condiciones base
    }

    const client = await Client.findOne({ $or: orConditions })
      .populate("organizationId")
      .exec();

    if (!client) {
      throw new Error("Cliente no encontrado");
    }
    return client;
  },

  // Actualizar un cliente
  updateClient: async (id, clientData) => {
    const { name, email, phoneNumber, phone_country, organizationId, birthDate } = clientData;
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

    // 🌍 Determinar si necesitamos re-normalizar el teléfono
    const phoneChanged = phoneNumber !== undefined && phoneNumber !== client.phoneNumber;
    const countryChanged = phone_country !== undefined && phone_country !== client.phone_country;
    
    if (phoneChanged || countryChanged) {
      // Usar el nuevo número si se proporcionó, sino el actual
      const numberToNormalize = phoneChanged ? phoneNumber : client.phoneNumber;
      // Usar el nuevo país si se proporcionó, sino el defaultCountry
      const countryToUse = phone_country !== undefined ? phone_country : defaultCountry;
      
      const phoneResult = normalizePhoneNumber(numberToNormalize, countryToUse);
      if (!phoneResult.isValid) {
        throw new Error(phoneResult.error);
      }

      // Actualizar campos de teléfono
      client.phoneNumber = phoneResult.phone_national_clean;
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
  registerService: async (id, organization) => {
    const client = await Client.findById(id);
    if (!client) {
      throw new Error("Cliente no encontrado");
    }

    // Usar tiers nuevos; fallback a campo legacy si no hay tiers configurados
    const serviceTiers = organization?.serviceTiers?.length > 0
      ? organization.serviceTiers
      : (organization?.serviceCount > 0
          ? [{ threshold: organization.serviceCount, reward: organization.serviceReward || "Descuento especial" }]
          : []);

    const { rewardEarned, earnedRewards } = await client.incrementServices(serviceTiers);

    if (rewardEarned && client.phone_e164 && organization) {
      for (const earned of earnedRewards) {
        try {
          const whatsappDoc = await WhatsappTemplate.findOne({ organizationId: organization._id });
          const isEnabled = whatsappDoc?.enabledTypes?.loyaltyServiceReward !== false;
          if (isEnabled) {
            const msg = await whatsappTemplates.getRenderedTemplate(
              organization._id.toString(),
              'loyaltyServiceReward',
              { names: client.name, reward: earned.reward, organization: organization.name }
            );
            await whatsappService.sendMessage(organization._id.toString(), client.phone_e164, msg);
            console.log(`[registerService] WA de recompensa enviado a ${client.name}: ${earned.reward}`);
          }
        } catch (waError) {
          console.error('[registerService] Error enviando WA de recompensa:', waError.message);
        }
      }
    }

    return client;
  },

  // Registrar un referido para un cliente (independiente del contador de servicios)
  registerReferral: async (id, organization) => {
    const client = await Client.findById(id);
    if (!client) {
      throw new Error("Cliente no encontrado");
    }

    // Usar tiers nuevos; fallback a campo legacy si no hay tiers configurados
    const referralTiers = organization?.referralTiers?.length > 0
      ? organization.referralTiers
      : (organization?.referredCount > 0
          ? [{ threshold: organization.referredCount, reward: organization.referredReward || "Beneficio especial" }]
          : []);

    const { rewardEarned, earnedRewards } = await client.incrementReferrals(referralTiers);

    if (rewardEarned && client.phone_e164 && organization) {
      for (const earned of earnedRewards) {
        try {
          const whatsappDoc = await WhatsappTemplate.findOne({ organizationId: organization._id });
          const isEnabled = whatsappDoc?.enabledTypes?.loyaltyReferralReward !== false;
          if (isEnabled) {
            const msg = await whatsappTemplates.getRenderedTemplate(
              organization._id.toString(),
              'loyaltyReferralReward',
              { names: client.name, reward: earned.reward, organization: organization.name }
            );
            await whatsappService.sendMessage(organization._id.toString(), client.phone_e164, msg);
            console.log(`[registerReferral] WA de recompensa enviado a ${client.name}: ${earned.reward}`);
          }
        } catch (waError) {
          console.error('[registerReferral] Error enviando WA de recompensa:', waError.message);
        }
      }
    }

    return client;
  },

  // Marcar una recompensa como canjeada
  redeemReward: async (clientId, rewardId) => {
    const client = await Client.findById(clientId);
    if (!client) {
      throw new Error("Cliente no encontrado");
    }

    const reward = client.rewardHistory.id(rewardId);
    if (!reward) {
      throw new Error("Recompensa no encontrada");
    }

    if (reward.redeemed) {
      throw new Error("Esta recompensa ya fue canjeada");
    }

    reward.redeemed = true;
    reward.redeemedAt = new Date();
    await client.save();
    return client;
  },

  // Restablecer contadores de fidelidad de un cliente
  resetClientLoyalty: async (clientId) => {
    const client = await Client.findById(clientId);
    if (!client) throw new Error("Cliente no encontrado");
    client.servicesTaken = 0;
    client.referralsMade = 0;
    return await client.save();
  },

  // Restablecer contadores de fidelidad de todos los clientes de una organización
  resetAllClientsLoyalty: async (organizationId) => {
    const result = await Client.updateMany(
      { organizationId },
      { $set: { servicesTaken: 0, referralsMade: 0 } }
    );
    return result.modifiedCount;
  },

  // Fusionar cliente origen (source) en cliente destino (target)
  mergeClient: async (targetId, sourceId) => {
    if (targetId === sourceId) {
      throw new Error("No puedes fusionar un cliente consigo mismo");
    }

    const [target, source] = await Promise.all([
      Client.findById(targetId),
      Client.findById(sourceId),
    ]);

    if (!target) throw new Error("Cliente destino no encontrado");
    if (!source) throw new Error("Cliente origen no encontrado");
    if (target.organizationId.toString() !== source.organizationId.toString()) {
      throw new Error("Los clientes deben pertenecer a la misma organización");
    }

    // Reasignar citas, paquetes y reservaciones del origen al destino
    await Appointment.updateMany({ client: sourceId }, { client: targetId });
    await ClientPackage.updateMany({ clientId: sourceId }, { clientId: targetId });
    await Reservation.updateMany({ customer: sourceId }, { customer: targetId });

    // Sumar contadores y combinar historial de recompensas
    target.servicesTaken += source.servicesTaken;
    target.referralsMade += source.referralsMade;
    target.rewardHistory.push(...source.rewardHistory);
    await target.save();

    // Eliminar cliente origen
    await Client.deleteOne({ _id: sourceId });

    return target;
  },

  // Eliminar cliente y todos sus registros relacionados
  forceDeleteClient: async (id) => {
    const client = await Client.findById(id);
    if (!client) {
      throw new Error("Cliente no encontrado");
    }

    await Appointment.deleteMany({ client: id });
    await ClientPackage.deleteMany({ clientId: id });
    await Reservation.updateMany({ customer: id }, { $set: { customer: null } });
    await Client.deleteOne({ _id: id });

    return { message: "Cliente y sus registros eliminados correctamente" };
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
