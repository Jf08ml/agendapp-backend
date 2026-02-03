import organizationService from "../services/organizationService.js";
import sendResponse from "../utils/sendResponse.js";
import whatsappTemplates from "../utils/whatsappTemplates.js";
import WhatsappTemplate from "../models/whatsappTemplateModel.js";

/**
 * Controlador para gestionar plantillas de WhatsApp personalizadas por organización
 */
const whatsappTemplateController = {
  /**
   * Obtiene todas las plantillas de WhatsApp de una organización
   * Retorna las plantillas personalizadas o las por defecto del sistema
   */
  getTemplates: async (req, res) => {
    try {
      const { organizationId } = req.params;

      const organization = await organizationService.getOrganizationById(organizationId);
      if (!organization) {
        return sendResponse(res, 404, null, "Organización no encontrada");
      }

      // Buscar templates personalizados en la colección
      let templateDoc = await WhatsappTemplate.findOne({ organizationId });

      // Plantillas por defecto del sistema (definidas en whatsappTemplates.js)
      const defaultTemplates = {
        scheduleAppointment: whatsappTemplates.getDefaultTemplate('scheduleAppointment'),
        scheduleAppointmentBatch: whatsappTemplates.getDefaultTemplate('scheduleAppointmentBatch'),
        recurringAppointmentSeries: whatsappTemplates.getDefaultTemplate('recurringAppointmentSeries'),
        reminder: whatsappTemplates.getDefaultTemplate('reminder'),
        secondReminder: whatsappTemplates.getDefaultTemplate('secondReminder'),
        statusReservationApproved: whatsappTemplates.getDefaultTemplate('statusReservationApproved'),
        statusReservationRejected: whatsappTemplates.getDefaultTemplate('statusReservationRejected'),
        clientConfirmationAck: whatsappTemplates.getDefaultTemplate('clientConfirmationAck'),
        clientCancellationAck: whatsappTemplates.getDefaultTemplate('clientCancellationAck'),
      };

      // Plantillas personalizadas (si existen)
      const customTemplates = templateDoc || {};

      // Combinar: usar personalizada si existe, sino la por defecto
      const templates = {
        scheduleAppointment: {
          content: customTemplates.scheduleAppointment || defaultTemplates.scheduleAppointment,
          isCustom: !!customTemplates.scheduleAppointment,
          variables: ['{{names}}', '{{date}}', '{{organization}}', '{{address}}', '{{service}}', '{{employee}}', '{{cancellationLink}}'],
        },
        scheduleAppointmentBatch: {
          content: customTemplates.scheduleAppointmentBatch || defaultTemplates.scheduleAppointmentBatch,
          isCustom: !!customTemplates.scheduleAppointmentBatch,
          variables: ['{{names}}', '{{dateRange}}', '{{organization}}', '{{address}}', '{{servicesList}}', '{{employee}}', '{{cancellationLink}}'],
        },
        recurringAppointmentSeries: {
          content: customTemplates.recurringAppointmentSeries || defaultTemplates.recurringAppointmentSeries,
          isCustom: !!customTemplates.recurringAppointmentSeries,
          variables: ['{{names}}', '{{organization}}', '{{address}}', '{{employee}}', '{{appointmentsList}}', '{{cancellationLink}}'],
        },
        reminder: {
          content: customTemplates.reminder || defaultTemplates.reminder,
          isCustom: !!customTemplates.reminder,
          variables: ['{{names}}', '{{count}}', '{{cita_pal}}', '{{agendada_pal}}', '{{date_range}}', '{{organization}}', '{{address}}', '{{services_list}}', '{{employee}}', '{{manage_block}}', '{{recommendations}}'],
        },
        secondReminder: {
          content: customTemplates.secondReminder || defaultTemplates.secondReminder,
          isCustom: !!customTemplates.secondReminder,
          variables: ['{{names}}', '{{count}}', '{{cita_pal}}', '{{agendada_pal}}', '{{date_range}}', '{{organization}}', '{{address}}', '{{services_list}}', '{{employee}}', '{{manage_block}}', '{{recommendations}}'],
        },
        statusReservationApproved: {
          content: customTemplates.statusReservationApproved || defaultTemplates.statusReservationApproved,
          isCustom: !!customTemplates.statusReservationApproved,
          variables: ['{{names}}', '{{date}}', '{{organization}}', '{{address}}', '{{service}}', '{{cancellationLink}}'],
        },
        statusReservationRejected: {
          content: customTemplates.statusReservationRejected || defaultTemplates.statusReservationRejected,
          isCustom: !!customTemplates.statusReservationRejected,
          variables: ['{{names}}', '{{date}}', '{{organization}}'],
        },
        clientConfirmationAck: {
          content: customTemplates.clientConfirmationAck || defaultTemplates.clientConfirmationAck,
          isCustom: !!customTemplates.clientConfirmationAck,
          variables: ['{{names}}', '{{appointments_list}}'],
        },
        clientCancellationAck: {
          content: customTemplates.clientCancellationAck || defaultTemplates.clientCancellationAck,
          isCustom: !!customTemplates.clientCancellationAck,
          variables: ['{{names}}', '{{appointments_list}}'],
        },
      };

      // También enviar los templates por defecto para el botón "Restaurar"
      sendResponse(res, 200, { 
        templates, 
        defaultTemplates 
      }, "Plantillas obtenidas correctamente");
    } catch (error) {
      console.error("Error obteniendo plantillas:", error);
      sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * Actualiza una plantilla específica de WhatsApp para una organización
   */
  updateTemplate: async (req, res) => {
    try {
      const { organizationId } = req.params;
      const { templateType, content } = req.body;

      // Validar que el tipo de template sea válido
      const validTypes = [
        'scheduleAppointment',
        'scheduleAppointmentBatch',
        'recurringAppointmentSeries',
        'reminder',
        'secondReminder',
        'statusReservationApproved',
        'statusReservationRejected',
        'clientConfirmationAck',
        'clientCancellationAck',
      ];

      if (!validTypes.includes(templateType)) {
        return sendResponse(res, 400, null, "Tipo de plantilla inválido");
      }

      if (!content || typeof content !== 'string') {
        return sendResponse(res, 400, null, "El contenido de la plantilla es requerido");
      }

      const organization = await organizationService.getOrganizationById(organizationId);
      if (!organization) {
        return sendResponse(res, 404, null, "Organización no encontrada");
      }

      // Buscar o crear documento de templates
      let templateDoc = await WhatsappTemplate.findOne({ organizationId });
      
      if (!templateDoc) {
        console.log('📝 Creando nuevo documento de templates para org:', organizationId);
        templateDoc = new WhatsappTemplate({ organizationId });
      } else {
        console.log('✏️ Actualizando documento existente para org:', organizationId);
      }
      
      templateDoc[templateType] = content;
      await templateDoc.save();

      console.log('✅ Template guardado:', {
        organizationId,
        templateType,
        contentLength: content.length,
        preview: content.substring(0, 50) + '...',
      });

      sendResponse(res, 200, { 
        templateType, 
        content,
        isCustom: true,
      }, "Plantilla actualizada correctamente");
    } catch (error) {
      console.error("Error actualizando plantilla:", error);
      sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * Restaura una plantilla a su versión por defecto del sistema
   */
  resetTemplate: async (req, res) => {
    try {
      const { organizationId } = req.params;
      const { templateType } = req.body;

      const validTypes = [
        'scheduleAppointment',
        'scheduleAppointmentBatch',
        'recurringAppointmentSeries',
        'reminder',
        'secondReminder',
        'statusReservationApproved',
        'statusReservationRejected',
        'clientConfirmationAck',
        'clientCancellationAck',
      ];

      if (!validTypes.includes(templateType)) {
        return sendResponse(res, 400, null, "Tipo de plantilla inválido");
      }

      const organization = await organizationService.getOrganizationById(organizationId);
      if (!organization) {
        return sendResponse(res, 404, null, "Organización no encontrada");
      }

      // Buscar documento de templates
      let templateDoc = await WhatsappTemplate.findOne({ organizationId });
      
      if (templateDoc) {
        // Establecer en null para usar el template por defecto
        templateDoc[templateType] = null;
        await templateDoc.save();
      }

      const defaultContent = whatsappTemplates.getDefaultTemplate(templateType);

      sendResponse(res, 200, { 
        templateType, 
        content: defaultContent,
        isCustom: false,
      }, "Plantilla restaurada a versión por defecto");
    } catch (error) {
      console.error("Error restaurando plantilla:", error);
      sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * Actualiza todas las plantillas de una organización
   */
  updateAllTemplates: async (req, res) => {
    try {
      const { organizationId } = req.params;
      const { templates } = req.body;

      if (!templates || typeof templates !== 'object') {
        return sendResponse(res, 400, null, "Plantillas inválidas");
      }

      const organization = await organizationService.getOrganizationById(organizationId);
      if (!organization) {
        return sendResponse(res, 404, null, "Organización no encontrada");
      }

      // Validar que solo se actualicen tipos válidos
      const validTypes = [
        'scheduleAppointment',
        'scheduleAppointmentBatch',
        'recurringAppointmentSeries',
        'reminder',
        'secondReminder',
        'statusReservationApproved',
        'statusReservationRejected',
        'clientConfirmationAck',
        'clientCancellationAck',
      ];

      for (const key in templates) {
        if (!validTypes.includes(key)) {
          return sendResponse(res, 400, null, `Tipo de plantilla inválido: ${key}`);
        }
      }

      // Buscar o crear documento de templates
      let templateDoc = await WhatsappTemplate.findOne({ organizationId });
      
      if (!templateDoc) {
        templateDoc = new WhatsappTemplate({ organizationId });
      }

      // Actualizar todas las plantillas
      Object.assign(templateDoc, templates);
      await templateDoc.save();

      sendResponse(res, 200, templateDoc, "Todas las plantillas actualizadas correctamente");
    } catch (error) {
      console.error("Error actualizando todas las plantillas:", error);
      sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * Preview de una plantilla con datos de ejemplo
   */
  previewTemplate: async (req, res) => {
    try {
      const { templateType, content } = req.body;

      if (!content || typeof content !== 'string') {
        return sendResponse(res, 400, null, "El contenido de la plantilla es requerido");
      }

      // Datos de ejemplo para preview
      const sampleData = {
        names: "María García",
        date: "15 de enero a las 3:00 PM",
        dateRange: "15 de enero a las 2:00 PM – 4:30 PM",
        date_range: "15 de enero a las 2:00 PM – 4:30 PM",
        organization: "Salón Bella Vista",
        address: "Calle 123 #45-67, Centro Comercial Plaza",
        service: "Corte y Color",
        employee: "Ana López",
        cancellationLink: "https://agenda.example.com/cancel/abc123",
        servicesList: `  1. Corte de cabello (2:00 PM – 2:45 PM)
  2. Tinte completo (2:45 PM – 4:30 PM)`,
        services_list: `  1. Corte de cabello (2:00 PM – 2:45 PM)
  2. Tinte completo (2:45 PM – 4:30 PM)`,
        appointmentsList: `
1. *lunes, 13 de enero*
     • Corte de cabello (10:00 a. m. - 10:30 a. m.)
     • Tinte (10:30 a. m. - 11:30 a. m.)

2. *lunes, 20 de enero*
     • Corte de cabello (10:00 a. m. - 10:30 a. m.)
     • Tinte (10:30 a. m. - 11:30 a. m.)

3. *lunes, 27 de enero*
     • Corte de cabello (10:00 a. m. - 10:30 a. m.)
     • Tinte (10:30 a. m. - 11:30 a. m.)`,
        count: "2",
        cita_pal: "citas",
        agendada_pal: "agendadas",
        appointments_list: `  1. Corte de cabello – 15/01/2026 a las 03:00 PM\n  2. Tinte – 22/01/2026 a las 03:00 PM`,
        manage_block: "https://agenda.example.com/manage/abc123",
        recommendations: `\n\n📝 *Recomendaciones:*\n• Llegar 10 minutos antes\n• Traer el cabello limpio y seco`,
      };

      // Renderizar la plantilla con los datos de ejemplo
      let preview = content;
      for (const [key, value] of Object.entries(sampleData)) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        preview = preview.replace(regex, value);
      }

      sendResponse(res, 200, { preview }, "Preview generado correctamente");
    } catch (error) {
      console.error("Error generando preview:", error);
      sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * 🆕 Obtiene la configuración de envíos (enabledTypes)
   */
  getTemplateSettings: async (req, res) => {
    try {
      const { organizationId } = req.params;

      const organization = await organizationService.getOrganizationById(organizationId);
      if (!organization) {
        return sendResponse(res, 404, null, "Organización no encontrada");
      }

      let templateDoc = await WhatsappTemplate.findOne({ organizationId });

      // Si no existe documento, retornar defaults
      if (!templateDoc) {
        const defaults = {
          scheduleAppointment: true,
          scheduleAppointmentBatch: true,
          recurringAppointmentSeries: true,
          reminder: true,
          secondReminder: true,
          statusReservationApproved: false,
          statusReservationRejected: false,
          clientConfirmationAck: true,
          clientCancellationAck: true,
        };
        return sendResponse(res, 200, defaults, "Configuración por defecto");
      }

      const settings = templateDoc.enabledTypes || {
        scheduleAppointment: true,
        scheduleAppointmentBatch: true,
        recurringAppointmentSeries: true,
        reminder: true,
        secondReminder: true,
        statusReservationApproved: false,
        statusReservationRejected: false,
        clientConfirmationAck: true,
        clientCancellationAck: true,
      };

      sendResponse(res, 200, settings, "Configuración obtenida correctamente");
    } catch (error) {
      console.error("Error obteniendo configuración:", error);
      sendResponse(res, 500, null, error.message);
    }
  },

  /**
   * 🆕 Actualiza la configuración de envíos (enabledTypes)
   */
  updateTemplateSettings: async (req, res) => {
    try {
      const { organizationId } = req.params;
      const { enabledTypes } = req.body;

      if (!enabledTypes) {
        return sendResponse(res, 400, null, "enabledTypes es requerido");
      }

      // Validar que enabledTypes tenga la estructura correcta
      const validKeys = [
        'scheduleAppointment',
        'scheduleAppointmentBatch',
        'recurringAppointmentSeries',
        'reminder',
        'secondReminder',
        'statusReservationApproved',
        'statusReservationRejected',
        'clientConfirmationAck',
        'clientCancellationAck',
      ];

      for (const key of Object.keys(enabledTypes)) {
        if (!validKeys.includes(key)) {
          return sendResponse(res, 400, null, `Tipo de mensaje inválido: ${key}`);
        }
        if (typeof enabledTypes[key] !== 'boolean') {
          return sendResponse(res, 400, null, `${key} debe ser booleano`);
        }
      }

      const updated = await WhatsappTemplate.findOneAndUpdate(
        { organizationId },
        { enabledTypes },
        { new: true, upsert: true }
      );

      console.log(`✅ Configuración de envíos actualizada para org ${organizationId}`);
      sendResponse(res, 200, updated.enabledTypes, "Configuración actualizada correctamente");
    } catch (error) {
      console.error("Error actualizando configuración:", error);
      sendResponse(res, 500, null, error.message);
    }
  },
};

export default whatsappTemplateController;
