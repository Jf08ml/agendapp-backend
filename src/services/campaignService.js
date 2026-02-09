// services/campaignService.js
import Campaign from "../models/campaignModel.js";
import organizationModel from "../models/organizationModel.js";
import clientModel from "../models/clientModel.js";
import { waBulkSend, waBulkGet, waBulkOptIn } from "./waHttpService.js";
import { normalizePhoneNumber, toWhatsappFormat } from "../utils/phoneUtils.js";

export const campaignService = {
  /**
   * Valida y normaliza una lista de teléfonos
   * Retorna análisis completo con validación, deduplicación y estado de consentimiento
   */
  validatePhones: async ({ phones, orgId }) => {
    const normalized = [];
    const invalid = [];
    const duplicates = [];
    const seen = new Set();

    // Obtener país por defecto de la organización
    const org = await organizationModel.findById(orgId).select('default_country');
    const defaultCountry = org?.default_country || 'CO';

    // 1. Normalizar y validar cada teléfono
    for (const phone of phones) {
      const result = normalizePhoneNumber(phone, defaultCountry);
      
      // Validar que sea válido y en formato E.164
      if (!result.isValid || !result.phone_e164) {
        invalid.push(phone);
        continue;
      }

      const clean = result.phone_e164;

      // Detectar duplicados
      if (seen.has(clean)) {
        duplicates.push(clean);
        continue;
      }

      seen.add(clean);
      normalized.push(clean);
    }

    // 2. TODO: Consultar estado de opt-in desde microservicio
    // Por ahora, retornar estructura básica
    const consentStatus = normalized.map((phone) => ({
      phone,
      hasConsent: true, // TODO: consultar real
    }));

    const withConsent = consentStatus.filter((c) => c.hasConsent).length;
    const withoutConsent = normalized.length - withConsent;

    return {
      total: phones.length,
      valid: normalized.length,
      invalid: invalid.length,
      duplicates: duplicates.length,
      withConsent,
      withoutConsent,
      normalized,
      invalidNumbers: invalid,
      duplicateNumbers: duplicates,
      consentStatus,
    };
  },

  /**
   * Crea y envía una campaña de WhatsApp
   */
  createAndSend: async ({
    orgId,
    userId,
    title,
    message,
    recipients, // [{ phone, name? }]
    image,
    dryRun = false,
  }) => {
    // 1. Validar organización y obtener clientId de WhatsApp + país por defecto
    const org = await organizationModel.findById(orgId).select('clientIdWhatsapp default_country');
    if (!org) throw new Error("Organización no encontrada");

    const clientId = org.clientIdWhatsapp;
    if (!clientId) {
      throw new Error(
        "La organización no tiene configurada una sesión de WhatsApp"
      );
    }

    const defaultCountry = org.default_country || 'CO';

    // 2. Normalizar y preparar items
    const items = [];
    const seen = new Set();

    for (const recipient of recipients) {
      // Normalizar usando el sistema moderno multi-país
      const phoneResult = normalizePhoneNumber(recipient.phone, defaultCountry);
      
      if (!phoneResult.isValid || !phoneResult.phone_e164) {
        console.warn(`[Campaign] Número inválido ignorado: ${recipient.phone}`);
        continue;
      }

      const phone = toWhatsappFormat(phoneResult.phone_e164);
      
      if (seen.has(phone)) {
        console.warn(`[Campaign] Número duplicado ignorado: ${phone}`);
        continue;
      }
      
      seen.add(phone);
      
      // Renderizar mensaje si hay placeholders
      let renderedMessage = message;
      if (recipient.name) {
        renderedMessage = renderedMessage.replace(/\{\{name\}\}/g, recipient.name);
      }
      
      items.push({
        phone,
        name: recipient.name,
        message: renderedMessage,
        status: "pending",
      });
    }

    if (items.length === 0) {
      throw new Error("No hay destinatarios válidos");
    }

    // 3. Crear registro de campaña
    const campaign = await Campaign.create({
      organizationId: orgId,
      createdBy: userId,
      title,
      message,
      image,
      isDryRun: dryRun,
      status: dryRun ? "dry-run" : "running",
      stats: {
        total: items.length,
        pending: items.length,
      },
      items,
      startedAt: dryRun ? null : new Date(),
    });

    // 4. Agregar números a la lista de opt-in del microservicio
    // Esto es CRÍTICO: el microservicio solo envía a números que estén en opt-in
    try {
      const phonesToOptIn = items.map((it) => it.phone);
      console.log(`[Campaign] Agregando ${phonesToOptIn.length} números a opt-in...`);
      await waBulkOptIn(phonesToOptIn);
      console.log(`[Campaign] Opt-in completado`);
    } catch (error) {
      console.error('[Campaign] Error agregando números a opt-in:', error);
      // No lanzamos error aquí, intentamos enviar de todas formas
    }

    // 5. Enviar al microservicio Baileys
    try {
      const bulkItems = items.map((it) => ({
        phone: it.phone,
        message: it.message,
      }));

      const result = await waBulkSend({
        clientId,
        title,
        items: bulkItems,
        messageTpl: message, // Mensaje original como template (requerido por el microservicio)
        image,
        dryRun,
        preRendered: true, // Mensajes ya renderizados
      });

      // Actualizar campaña con bulkId
      campaign.bulkId = result.bulkId;
      await campaign.save();

      // Si es Dry Run, el microservicio simula todo instantáneamente
      // Debemos marcar los items como "enviados" inmediatamente
      if (dryRun) {
        campaign.items.forEach((item) => {
          item.status = "sent";
          item.sentAt = new Date();
        });
        campaign.status = "completed";
        campaign.stats.sent = campaign.stats.total;
        campaign.stats.pending = 0;
        campaign.completedAt = new Date();
        await campaign.save();
      }

      return {
        ok: true,
        campaign: campaign.toObject(),
      };
    } catch (error) {
      // Marcar campaña como fallida
      campaign.status = "failed";
      campaign.errorMessage = error.message;
      await campaign.save();
      throw error;
    }
  },

  /**
   * Lista campañas de una organización
   */
  listCampaigns: async ({ orgId, page = 1, limit = 10, status }) => {
    const skip = (page - 1) * limit;
    const filter = { organizationId: orgId };
    
    if (status) {
      filter.status = status;
    }

    const [campaigns, total] = await Promise.all([
      Campaign.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("-items") // No incluir items en lista (pesado)
        .lean(),
      Campaign.countDocuments(filter),
    ]);

    return {
      ok: true,
      campaigns,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Obtiene detalle completo de una campaña
   * Sincroniza con el microservicio si está activa
   */
  getCampaignDetail: async ({ orgId, campaignId }) => {
    const campaign = await Campaign.findOne({
      _id: campaignId,
      organizationId: orgId,
    });

    if (!campaign) {
      throw new Error("Campaña no encontrada");
    }

    // Si la campaña está en progreso, sincronizar con microservicio
    if (campaign.status === "running" && campaign.bulkId) {
      try {
        const bulkData = await waBulkGet(campaign.bulkId);
        
        // Actualizar stats
        const sentCount = bulkData.stats?.sent || 0;
        const failedCount = bulkData.stats?.failed || 0;
        const skippedCount = bulkData.stats?.skipped || 0;
        const totalCount = bulkData.stats?.total || campaign.stats.total;
        const pendingCount = Math.max(0, totalCount - sentCount - failedCount - skippedCount);

        campaign.stats = {
          total: totalCount,
          sent: sentCount,
          failed: failedCount,
          pending: pendingCount,
          skipped: skippedCount,
        };

        // Actualizar items individuales si el microservicio los provee
        if (bulkData.items && Array.isArray(bulkData.items) && bulkData.items.length > 0) {
          // Crear un mapa de items del microservicio por teléfono
          const itemsMap = new Map();
          bulkData.items.forEach((item) => {
            itemsMap.set(item.phone, item);
          });

          const isCompleted = bulkData.status === "done";
          const now = new Date();

          // Actualizar items de la campaña
          campaign.items = campaign.items.map((campaignItem) => {
            const microItem = itemsMap.get(campaignItem.phone);
            
            if (microItem) {
              // Determinar status basado en la estructura del microservicio
              let status = campaignItem.status;
              let sentAt = campaignItem.sentAt;
              let errorMessage = campaignItem.errorMessage;

              if (microItem.skip) {
                // Item saltado por alguna razón
                status = "skipped";
                errorMessage = microItem.skipReason || "Saltado";
              } else if (isCompleted) {
                // Si la campaña está completada y el item no fue saltado, se envió
                status = "sent";
                sentAt = sentAt || now;
              } else if (bulkData.status === "running") {
                // Si está en progreso, mantener como pendiente o enviado según stats
                status = campaignItem.status;
              }

              return {
                phone: campaignItem.phone,
                name: campaignItem.name,
                message: campaignItem.message,
                status,
                sentAt,
                errorMessage,
              };
            }
            
            return campaignItem;
          });
        } else if (bulkData.status === "done") {
          // Si no hay items pero la campaña está completada, marcar items según stats
          const now = new Date();
          const sentCount = bulkData.stats?.sent || 0;
          const skippedCount = bulkData.stats?.skipped || 0;
          
          let sentCounter = 0;
          let skippedCounter = 0;

          campaign.items = campaign.items.map((item) => {
            if (item.status === "pending") {
              // Distribuir entre sent y skipped según las stats
              if (skippedCounter < skippedCount) {
                skippedCounter++;
                return { ...item, status: "skipped", errorMessage: "Saltado" };
              } else if (sentCounter < sentCount) {
                sentCounter++;
                return { ...item, status: "sent", sentAt: now };
              }
            }
            return item;
          });
        }

        // Actualizar status de la campaña
        if (bulkData.status === "done") {
          campaign.status = "completed";
          campaign.completedAt = new Date();
        } else if (bulkData.status === "cancelled") {
          campaign.status = "cancelled";
          campaign.cancelledAt = new Date();
        } else if (bulkData.status === "error") {
          campaign.status = "failed";
          campaign.errorMessage = "Error en el microservicio";
        }

        await campaign.save();
        
        // Verificación final: Si la campaña está completada pero hay items pendientes, corregir
        const pendingItems = campaign.items.filter(item => item.status === "pending").length;
        if (campaign.status === "completed" && pendingItems > 0) {
          const now = new Date();
          campaign.items = campaign.items.map((item) => {
            if (item.status === "pending") {
              return { ...item, status: "sent", sentAt: now };
            }
            return item;
          });
          await campaign.save();
        }
      } catch (error) {
        console.error(
          `Error sincronizando campaña ${campaignId}:`,
          error.message
        );
      }
    }

    return {
      ok: true,
      campaign: campaign.toObject(),
    };
  },

  /**
   * Cancela una campaña en progreso
   */
  cancelCampaign: async ({ orgId, campaignId }) => {
    const campaign = await Campaign.findOne({
      _id: campaignId,
      organizationId: orgId,
    });

    if (!campaign) {
      throw new Error("Campaña no encontrada");
    }

    if (campaign.status !== "running") {
      throw new Error("Solo se pueden cancelar campañas en progreso");
    }

    // TODO: Llamar al microservicio para cancelar
    // await waBulkCancel(campaign.bulkId);

    campaign.status = "cancelled";
    campaign.cancelledAt = new Date();
    await campaign.save();

    return {
      ok: true,
      message: "Campaña cancelada exitosamente",
    };
  },

  /**
   * Convierte una campaña Dry Run en campaña real
   * Crea una nueva campaña basada en el Dry Run
   */
  convertDryRunToReal: async ({ orgId, campaignId, userId }) => {
    const dryRunCampaign = await Campaign.findOne({
      _id: campaignId,
      organizationId: orgId,
    });

    if (!dryRunCampaign) {
      throw new Error("Campaña no encontrada");
    }

    if (!dryRunCampaign.isDryRun) {
      throw new Error("Esta campaña no es un Dry Run");
    }

    // Extraer recipients de los items del Dry Run
    const recipients = dryRunCampaign.items.map((item) => ({
      phone: item.phone,
      name: item.name,
    }));

    // Crear y enviar la campaña real usando la función existente
    return await campaignService.createAndSend({
      orgId,
      userId,
      title: `${dryRunCampaign.title} (Real)`,
      message: dryRunCampaign.message,
      recipients,
      image: dryRunCampaign.image,
      dryRun: false,
    });
  },

  /**
   * Obtiene clientes de una organización para selector de audiencia
   */
  getAudienceSuggestions: async ({ orgId, search = "", limit = 50, page = 1 }) => {
    const filter = { organizationId: orgId };
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
        { phone_e164: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;
    const total = await clientModel.countDocuments(filter);

    const clients = await clientModel
      .find(filter)
      .select("name phoneNumber phone_e164 phone_country email")
      .sort({ createdAt: -1 }) // Más recientes primero
      .skip(skip)
      .limit(limit)
      .lean();

    // Obtener país por defecto de la organización para normalizar teléfonos sin phone_e164
    const org = await organizationModel.findById(orgId).select('default_country');
    const defaultCountry = org?.default_country || 'CO';

    return {
      ok: true,
      clients: clients.map((c) => {
        // Preferir phone_e164 si existe
        let phone = c.phone_e164;
        
        // Si no existe phone_e164, intentar normalizar phoneNumber
        if (!phone && c.phoneNumber) {
          const phoneResult = normalizePhoneNumber(c.phoneNumber, c.phone_country || defaultCountry);
          phone = phoneResult.isValid ? phoneResult.phone_e164 : null;
        }
        
        return {
          id: c._id,
          name: c.name,
          phone: phone || c.phoneNumber, // Fallback al original si todo falla
          country: c.phone_country || defaultCountry,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasMore: skip + clients.length < total,
      },
    };
  },

  /**
   * Obtiene TODOS los clientes de una organización (para seleccionar todos)
   */
  getAllClientsForCampaign: async ({ orgId, search = "" }) => {
    const filter = { organizationId: orgId };
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
        { phone_e164: { $regex: search, $options: "i" } },
      ];
    }

    const clients = await clientModel
      .find(filter)
      .select("name phoneNumber phone_e164 phone_country")
      .sort({ createdAt: -1 })
      .lean();

    // Obtener país por defecto de la organización
    const org = await organizationModel.findById(orgId).select('default_country');
    const defaultCountry = org?.default_country || 'CO';

    return {
      ok: true,
      total: clients.length,
      clients: clients.map((c) => {
        // Preferir phone_e164 si existe
        let phone = c.phone_e164;
        
        // Si no existe phone_e164, intentar normalizar phoneNumber
        if (!phone && c.phoneNumber) {
          const phoneResult = normalizePhoneNumber(c.phoneNumber, c.phone_country || defaultCountry);
          phone = phoneResult.isValid ? phoneResult.phone_e164 : null;
        }
        
        return {
          id: c._id.toString(),
          name: c.name,
          phone: phone || c.phoneNumber, // Fallback al original si todo falla
          country: c.phone_country || defaultCountry,
        };
      }),
    };
  },
};
