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
    const { name, email, phoneNumber, organizationId, birthDate, documentId, notes } = clientData;

    const org = await Organization.findById(organizationId).select('default_country clientFormConfig');
    const defaultCountry = org?.default_country || 'CO';
    const identifierField = org?.clientFormConfig?.identifierField || 'phone';

    const clientDoc = { name, email, organizationId, birthDate };
    if (documentId) clientDoc.documentId = documentId.trim();
    if (notes) clientDoc.notes = notes.trim();

    // Normalizar teléfono si se provee
    if (phoneNumber) {
      const phoneResult = normalizePhoneNumber(phoneNumber, defaultCountry);
      if (!phoneResult.isValid) throw new Error(phoneResult.error);
      clientDoc.phoneNumber = phoneResult.phone_national_clean;
      clientDoc.phone_e164 = phoneResult.phone_e164;
      clientDoc.phone_country = phoneResult.phone_country;
    }

    // Verificar duplicado según el identificador configurado
    let duplicateQuery = { organizationId };
    if (identifierField === 'phone' && clientDoc.phone_e164) {
      duplicateQuery.$or = [
        { phone_e164: clientDoc.phone_e164 },
        { phoneNumber: clientDoc.phoneNumber },
      ];
    } else if (identifierField === 'email' && email) {
      duplicateQuery.email = email.toLowerCase().trim();
    } else if (identifierField === 'documentId' && clientDoc.documentId) {
      duplicateQuery.documentId = clientDoc.documentId;
    }

    if (duplicateQuery.$or || duplicateQuery.email || duplicateQuery.documentId) {
      const existing = await Client.findOne(duplicateQuery);
      if (existing) {
        const labels = { phone: 'teléfono', email: 'correo electrónico', documentId: 'número de documento' };
        throw new Error(`Ya existe un cliente con ese ${labels[identifierField]} en esta organización`);
      }
    }

    return await new Client(clientDoc).save();
  },

  // Buscar un cliente por el campo identificador configurado en la organización
  getClientByIdentifier: async (field, value, organizationId) => {
    if (!value || !field || !organizationId) return null;

    let query = { organizationId };

    if (field === 'phone') {
      const org = await Organization.findById(organizationId).select('default_country');
      const defaultCountry = org?.default_country || 'CO';
      const phoneResult = normalizePhoneNumber(value, defaultCountry);
      const conditions = [{ phoneNumber: value, organizationId }, { phone_e164: value, organizationId }];
      if (phoneResult.isValid) {
        conditions.push({ phone_e164: phoneResult.phone_e164, organizationId });
        conditions.push({ phoneNumber: phoneResult.phone_national_clean, organizationId });
      }
      return await Client.findOne({ $or: conditions }).populate('organizationId').exec();
    }

    if (field === 'email') {
      query.email = value.toLowerCase().trim();
    } else if (field === 'documentId') {
      query.documentId = value.trim();
    } else {
      return null;
    }

    return await Client.findOne(query).populate('organizationId').exec();
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
    
    if (searchQuery) {
      query.$or = [
        { name: { $regex: searchQuery, $options: "i" } },
        { phoneNumber: { $regex: searchQuery, $options: "i" } },
        { phone_e164: { $regex: searchQuery, $options: "i" } },
        { email: { $regex: searchQuery, $options: "i" } },
        { documentId: { $regex: searchQuery, $options: "i" } },
      ];
    }

    return await Client.find(query)
      .limit(limit)
      .select("_id name phoneNumber phone_e164 phone_country email birthDate documentId")
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
    const { name, email, phoneNumber, phone_country, organizationId, birthDate, documentId, notes } = clientData;
    const client = await Client.findById(id);

    if (!client) {
      throw new Error("Cliente no encontrado");
    }

    const org = await Organization.findById(client.organizationId).select('default_country clientFormConfig');
    const defaultCountry = org?.default_country || 'CO';
    const identifierField = org?.clientFormConfig?.identifierField || 'phone';

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
    if (documentId !== undefined) client.documentId = documentId ? documentId.trim() : documentId;
    if (notes !== undefined) client.notes = notes ? notes.trim() : notes;

    // Verificar duplicado por identificador si el campo cambió
    const labels = { phone: 'teléfono', email: 'correo electrónico', documentId: 'número de documento' };
    let dupQuery = { organizationId: client.organizationId, _id: { $ne: client._id } };
    if (identifierField === 'phone' && client.phone_e164) {
      dupQuery.$or = [{ phone_e164: client.phone_e164 }, { phoneNumber: client.phoneNumber }];
    } else if (identifierField === 'email' && client.email) {
      dupQuery.email = client.email.toLowerCase().trim();
    } else if (identifierField === 'documentId' && client.documentId) {
      dupQuery.documentId = client.documentId;
    }

    if (dupQuery.$or || dupQuery.email || dupQuery.documentId) {
      const dup = await Client.findOne(dupQuery);
      if (dup) throw new Error(`Ya existe otro cliente con ese ${labels[identifierField]}`);
    }

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

    const org = await Organization.findById(organizationId).select('default_country clientFormConfig');
    const defaultCountry = org?.default_country || 'CO';
    const identifierField = org?.clientFormConfig?.identifierField || 'phone';
    const identifierLabels = { phone: 'teléfono', email: 'correo electrónico', documentId: 'número de documento' };

    console.log(`[bulkCreateClients] Procesando ${clientsData.length} clientes para organización ${organizationId}, identificador: ${identifierField}`);

    for (let i = 0; i < clientsData.length; i++) {
      const row = clientsData[i];
      results.totalProcessed++;

      try {
        if (!row.name) throw new Error('El nombre es obligatorio');
        if (!row.phoneNumber) throw new Error('El teléfono es obligatorio');
        if (identifierField === 'email' && !row.email) throw new Error('El correo es obligatorio como identificador');
        if (identifierField === 'documentId' && !row.documentId) throw new Error('El número de documento es obligatorio como identificador');

        const cleanPhoneNumber = String(row.phoneNumber).trim();
        const phoneResult = normalizePhoneNumber(cleanPhoneNumber, defaultCountry);
        if (!phoneResult.isValid) throw new Error(phoneResult.error || 'Número de teléfono inválido');

        // Verificar duplicado según identificador configurado
        let dupQuery = { organizationId };
        if (identifierField === 'phone') {
          dupQuery.$or = [{ phone_e164: phoneResult.phone_e164 }, { phoneNumber: phoneResult.phone_national_clean }];
        } else if (identifierField === 'email') {
          dupQuery.email = row.email.toLowerCase().trim();
        } else if (identifierField === 'documentId') {
          dupQuery.documentId = String(row.documentId).trim();
        }
        const dup = await Client.findOne(dupQuery);
        if (dup) throw new Error(`Cliente duplicado — ya existe con ese ${identifierLabels[identifierField]}`);

        const newClient = new Client({
          name: row.name.trim(),
          email: row.email ? row.email.trim() : undefined,
          phoneNumber: phoneResult.phone_national_clean,
          phone_e164: phoneResult.phone_e164,
          phone_country: phoneResult.phone_country,
          documentId: row.documentId ? String(row.documentId).trim() : undefined,
          organizationId,
          birthDate: row.birthDate || null,
        });

        const savedClient = await newClient.save();
        results.success.push({ row: i + 2, name: savedClient.name, phoneNumber: savedClient.phoneNumber });
        results.totalSuccess++;

      } catch (error) {
        console.error(`[bulkCreateClients] Fila ${i + 2}: Error - ${error.message}`);
        results.errors.push({
          row: i + 2,
          name: row.name || 'Sin nombre',
          phoneNumber: row.phoneNumber || 'Sin teléfono',
          error: error.message,
        });
        results.totalErrors++;
      }
    }

    console.log(`[bulkCreateClients] Completado: ${results.totalSuccess} éxitos, ${results.totalErrors} errores`);
    return results;
  },
};

export default clientService;
