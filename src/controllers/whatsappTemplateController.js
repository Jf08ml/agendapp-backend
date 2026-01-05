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
        statusReservationApproved: whatsappTemplates.getDefaultTemplate('statusReservationApproved'),
        statusReservationRejected: whatsappTemplates.getDefaultTemplate('statusReservationRejected'),
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
          variables: ['{{names}}', '{{count}}', '{{cita_pal}}', '{{agendada_pal}}', '{{date_range}}', '{{organization}}', '{{address}}', '{{services_list}}', '{{employee}}'],
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
        'statusReservationApproved',
        'statusReservationRejected',
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
        'statusReservationApproved',
        'statusReservationRejected',
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
        'reminder',
        'statusReservationApproved',
        'statusReservationRejected',
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
};

export default whatsappTemplateController;
