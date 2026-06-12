import WhatsappTemplate from "../../models/whatsappTemplateModel.js";
import whatsappTemplates from "../../utils/whatsappTemplates.js";

// Tipos de plantilla válidos con su descripción y variables disponibles.
// Mantener en sincronía con whatsappTemplateModel.js y whatsappTemplateController.js
const TEMPLATE_TYPES = {
  scheduleAppointment: {
    label: "Confirmación de cita agendada",
    variables: ["{{names}}", "{{date}}", "{{organization}}", "{{address}}", "{{service}}", "{{employee}}", "{{cancellationLink}}"],
  },
  scheduleAppointmentBatch: {
    label: "Confirmación de varias citas agendadas",
    variables: ["{{names}}", "{{dateRange}}", "{{organization}}", "{{address}}", "{{servicesList}}", "{{employee}}", "{{cancellationLink}}"],
  },
  recurringAppointmentSeries: {
    label: "Confirmación de serie de citas recurrentes",
    variables: ["{{names}}", "{{organization}}", "{{address}}", "{{employee}}", "{{appointmentsList}}", "{{cancellationLink}}"],
  },
  reminder: {
    label: "Recordatorio de cita",
    variables: ["{{names}}", "{{count}}", "{{cita_pal}}", "{{agendada_pal}}", "{{date_range}}", "{{organization}}", "{{address}}", "{{services_list}}", "{{employee}}", "{{manage_block}}", "{{recommendations}}"],
  },
  secondReminder: {
    label: "Segundo recordatorio de cita",
    variables: ["{{names}}", "{{count}}", "{{cita_pal}}", "{{agendada_pal}}", "{{date_range}}", "{{organization}}", "{{address}}", "{{services_list}}", "{{employee}}", "{{manage_block}}", "{{recommendations}}"],
  },
  statusReservationPending: {
    label: "Reserva en línea recibida (pendiente de aprobación)",
    variables: ["{{names}}", "{{date}}", "{{organization}}", "{{servicesList}}"],
  },
  statusReservationApproved: {
    label: "Reserva en línea aprobada",
    variables: ["{{names}}", "{{date}}", "{{organization}}", "{{address}}", "{{service}}", "{{cancellationLink}}"],
  },
  statusReservationRejected: {
    label: "Reserva en línea rechazada",
    variables: ["{{names}}", "{{date}}", "{{organization}}"],
  },
  clientConfirmationAck: {
    label: "Agradecimiento cuando el cliente confirma asistencia",
    variables: ["{{names}}", "{{appointments_list}}"],
  },
  clientCancellationAck: {
    label: "Aviso cuando el cliente cancela",
    variables: ["{{names}}", "{{appointments_list}}"],
  },
  clientNoShowAck: {
    label: "Mensaje por inasistencia (no-show)",
    variables: ["{{names}}", "{{service}}", "{{date}}", "{{organization}}"],
  },
  loyaltyServiceReward: {
    label: "Felicitación por recompensa de fidelidad (servicios)",
    variables: ["{{names}}", "{{reward}}", "{{organization}}"],
  },
  loyaltyReferralReward: {
    label: "Felicitación por recompensa de referidos",
    variables: ["{{names}}", "{{reward}}", "{{organization}}"],
  },
  classEnrollmentConfirmed: {
    label: "Confirmación de inscripción a clase grupal",
    variables: ["{{names}}", "{{organization}}"],
  },
  classEnrollmentCancelled: {
    label: "Cancelación de inscripción a clase grupal",
    variables: ["{{names}}", "{{organization}}"],
  },
};

const VALID_TYPES = Object.keys(TEMPLATE_TYPES);

export default [
  {
    name: "get_whatsapp_templates",
    description: `Obtiene las plantillas de mensajes automáticos de WhatsApp de la organización (recordatorios, confirmaciones, fidelidad, etc.).
Para cada tipo devuelve: contenido actual, si es personalizada o la por defecto del sistema, si está habilitada, y las variables disponibles.
Úsalo antes de modificar una plantilla, o cuando el usuario pregunte qué mensajes automáticos tiene configurados.`,
    parameters: {
      templateType: {
        type: "string",
        description: `Tipo específico a consultar (opcional — si se omite, devuelve un resumen de todas). Valores: ${VALID_TYPES.join(", ")}`,
        required: false,
      },
    },
    handler: async (params, context) => {
      const doc = await WhatsappTemplate.findOne({ organizationId: context.organizationId }).lean();

      const buildEntry = (type) => {
        const custom = doc?.[type] || null;
        const enabled = doc?.enabledTypes?.[type];
        return {
          templateType: type,
          descripcion: TEMPLATE_TYPES[type].label,
          contenido: custom || whatsappTemplates.getDefaultTemplate(type),
          esPersonalizada: !!custom,
          habilitada: enabled !== undefined ? enabled : true,
          variablesDisponibles: TEMPLATE_TYPES[type].variables,
        };
      };

      if (params.templateType) {
        if (!VALID_TYPES.includes(params.templateType)) {
          return { success: false, error: `Tipo inválido: "${params.templateType}". Tipos válidos: ${VALID_TYPES.join(", ")}` };
        }
        return { success: true, template: buildEntry(params.templateType) };
      }

      // Resumen de todas (sin contenido completo para no inflar el contexto)
      const templates = VALID_TYPES.map((type) => {
        const e = buildEntry(type);
        return {
          templateType: e.templateType,
          descripcion: e.descripcion,
          esPersonalizada: e.esPersonalizada,
          habilitada: e.habilitada,
        };
      });
      return {
        success: true,
        templates,
        nota: "Para ver el contenido completo y las variables de una plantilla, vuelve a llamar con templateType.",
      };
    },
  },

  {
    name: "update_whatsapp_template",
    description: `Crea, modifica, restaura o habilita/deshabilita una plantilla de mensaje automático de WhatsApp.
Acciones:
- Pasar "content" → guarda ese contenido como plantilla personalizada.
- "reset": true → elimina la personalización y vuelve a la plantilla por defecto del sistema.
- "enabled": true/false → activa o desactiva el envío automático de ese tipo de mensaje.
Las variables se escriben como {{variable}} (consulta las disponibles con get_whatsapp_templates). Muestra al usuario el contenido final antes de guardar.`,
    parameters: {
      templateType: {
        type: "string",
        description: `Tipo de plantilla. Valores: ${VALID_TYPES.join(", ")}`,
        required: true,
      },
      content: {
        type: "string",
        description: "Nuevo contenido de la plantilla (con variables {{...}}). Omitir si solo se cambia enabled o se hace reset.",
        required: false,
      },
      enabled: {
        type: "boolean",
        description: "Habilitar (true) o deshabilitar (false) el envío automático de este tipo de mensaje.",
        required: false,
      },
      reset: {
        type: "boolean",
        description: "true para restaurar la plantilla por defecto del sistema (elimina la personalización).",
        required: false,
      },
    },
    handler: async (params, context) => {
      const { templateType, content, enabled, reset } = params;

      if (!VALID_TYPES.includes(templateType)) {
        return { success: false, error: `Tipo inválido: "${templateType}". Tipos válidos: ${VALID_TYPES.join(", ")}` };
      }
      if (content === undefined && enabled === undefined && !reset) {
        return { success: false, error: "Indica al menos una acción: content, enabled o reset." };
      }

      // Advertir sobre variables desconocidas en el contenido (no bloquea)
      const warnings = [];
      if (content) {
        const known = TEMPLATE_TYPES[templateType].variables;
        const used = content.match(/{{\s*[\w]+\s*}}/g) || [];
        const unknown = [...new Set(used.filter((v) => !known.includes(v.replace(/\s/g, ""))))];
        if (unknown.length > 0) {
          warnings.push(
            `Variables no reconocidas para este tipo (no serán reemplazadas al enviar): ${unknown.join(", ")}. Disponibles: ${known.join(", ")}`
          );
        }
      }

      let doc = await WhatsappTemplate.findOne({ organizationId: context.organizationId });
      if (!doc) doc = new WhatsappTemplate({ organizationId: context.organizationId });

      if (reset) {
        doc[templateType] = null;
      } else if (content !== undefined) {
        doc[templateType] = content;
      }
      if (enabled !== undefined) {
        doc.enabledTypes = { ...(doc.enabledTypes?.toObject?.() || doc.enabledTypes || {}), [templateType]: enabled };
      }
      await doc.save();

      return {
        success: true,
        templateType,
        descripcion: TEMPLATE_TYPES[templateType].label,
        esPersonalizada: !!doc[templateType],
        habilitada: doc.enabledTypes?.[templateType] !== undefined ? doc.enabledTypes[templateType] : true,
        contenidoActual: doc[templateType] || whatsappTemplates.getDefaultTemplate(templateType),
        ...(warnings.length > 0 && { advertencias: warnings }),
      };
    },
  },
];
