import WhatsappTemplate from "../models/whatsappTemplateModel.js";

const whatsappTemplates = {
  // ========================================
  // TEMPLATES POR DEFECTO DEL SISTEMA
  // ========================================
  
  /**
   * Obtiene el template por defecto sin renderizar (con placeholders)
   * Usado para mostrar en el editor y como fallback
   */
  getDefaultTemplate: (templateType) => {
    const templates = {
      scheduleAppointment: `📅 ¡Hola, {{names}}! 

¡Tu cita ha sido agendada exitosamente!

🗓️ Fecha: {{date}}
📍 Lugar: {{organization}}
📍 Dirección: {{address}}
✨ Servicio: {{service}}
👩‍💼 Te atenderá: {{employee}}

❌ Si necesitas cancelar tu cita, puedes hacerlo desde este enlace:
{{cancellationLink}}

Si tienes alguna pregunta o necesitas modificar tu cita, *puedes responder directamente a este chat de WhatsApp*. Estamos atentos a ayudarte.

¡Te esperamos pronto!`,

      scheduleAppointmentBatch: `📅 ¡Hola, {{names}}!

¡Tus citas han sido agendadas exitosamente!

🗓️ Fecha: {{dateRange}}
📍 Lugar: {{organization}}
📍 Dirección: {{address}}
✨ Servicios:
{{servicesList}}
👩‍💼 Te atenderá: {{employee}}

❌ Si necesitas cancelar tus citas, puedes hacerlo desde este enlace:
{{cancellationLink}}

Si necesitas ajustar horarios o cambiar algún servicio, *responde a este chat* y con gusto te ayudamos.

¡Te esperamos!`,

      recurringAppointmentSeries: `🔁 ¡Hola, {{names}}!

¡Tu serie de citas recurrentes ha sido creada exitosamente!

📍 Lugar: {{organization}}
📍 Dirección: {{address}}
👩‍💼 Te atenderá: {{employee}}

📅 *Tus citas programadas:*
{{appointmentsList}}

❌ *Cancelación flexible:*
Puedes cancelar todas tus citas o solo algunas desde este enlace:
{{cancellationLink}}

Si necesitas ajustar horarios o cambiar algún servicio, *responde a este chat* y con gusto te ayudamos.

¡Te esperamos en cada sesión!`,

      reminder: `📅 ¡Hola, {{names}}!

Recuerda que tienes {{count}} {{cita_pal}} {{agendada_pal}}.

🗓️ Fecha: {{date_range}}
📍 Lugar: {{organization}}
📍 Dirección: {{address}}

✨ Servicios:
{{services_list}}

👩‍💼 Te atenderá: {{employee}}
{{recommendations}}
Gestiona tu cita desde el siguiente enlace:
{{manage_block}}

Por favor confirma tu asistencia o cancela tu cita desde el enlace.
Si necesitas ayuda, puedes responder a este mensaje.

💖 ¡Te esperamos!`,

      secondReminder: `⏰ ¡Hola, {{names}}!

Tu cita es *muy pronto*.

🗓️ Fecha: {{date_range}}
📍 Lugar: {{organization}}
📍 Dirección: {{address}}

✨ Servicios:
{{services_list}}

👩‍💼 Te atenderá: {{employee}}
{{recommendations}}
Si no puedes asistir, cancela tu cita desde el siguiente enlace:
{{manage_block}}

💖 ¡Te esperamos!`,

      statusReservationApproved: `¡Hola, {{names}}! 🎉

Tu reserva para el {{date}} en {{organization}} ha sido *aprobada*.

📍 Dirección: {{address}}
✨ Servicio: {{service}}

❌ Si necesitas cancelar tu reserva, puedes hacerlo desde este enlace:
{{cancellationLink}}

Si tienes dudas o necesitas reprogramar, *responde a este chat de WhatsApp*. ¡Estamos para ayudarte!

¡Te esperamos!`,

      statusReservationRejected: `¡Hola, {{names}}! 👋

Lamentamos informarte que tu reserva para el *{{date}}* en *{{organization}}* no pudo ser confirmada, ya que el horario seleccionado no está disponible.

Si deseas reprogramar o tienes alguna pregunta, simplemente responde a este mensaje de WhatsApp y con gusto te ayudaremos.

Gracias por tu comprensión. ¡Esperamos atenderte pronto! 😊`,

  // 🆕 Agradecimiento por confirmar asistencia
  clientConfirmationAck: `¡Hola, {{names}}! ✅

Gracias por confirmar tu asistencia.

Estas son tus cita(s):
{{appointments_list}}

Si necesitas cambiar o cancelar, puedes usar el mismo enlace que recibiste o responder este mensaje. ¡Nos vemos pronto! 😊`,

  // 🆕 Aviso de cancelación al cliente
  clientCancellationAck: `¡Hola, {{names}}! ❌

Hemos registrado la cancelación de tu(s) cita(s):
{{appointments_list}}

Gracias por avisarnos. Si deseas reprogramar, responde a este mensaje y te ayudamos con un nuevo horario.`,

  // 🆕 Aviso de no asistencia al cliente
  clientNoShowAck: `¡Hola, {{names}}! 👋

Notamos que no pudiste asistir a tu cita:
• {{service}} - {{date}}

📍 {{organization}}

Si deseas reprogramar tu cita, responde a este mensaje y con gusto te ayudamos a encontrar un nuevo horario. ¡Te esperamos pronto!`,

      // 🏆 Premio por completar meta de servicios
      loyaltyServiceReward: `🎉 ¡Felicitaciones, {{names}}!

Has completado tu meta de servicios en *{{organization}}*.

🏅 Tu recompensa: *{{reward}}*

Preséntate en tu próxima visita y reclama tu beneficio. ¡Gracias por tu fidelidad!`,

      // 🎁 Premio por completar meta de referidos
      loyaltyReferralReward: `🎉 ¡Felicitaciones, {{names}}!

Has alcanzado tu meta de referidos en *{{organization}}*.

🎁 Tu recompensa: *{{reward}}*

Preséntate en tu próxima visita y reclama tu beneficio. ¡Gracias por recomendar nuestros servicios!`,

      // 📚 Inscripción a clase confirmada (aprobación automática o manual)
      classEnrollmentConfirmed: `✅ ¡Hola, {{names}}!

Tu inscripción a la clase ha sido *confirmada*.

📚 Clase: *{{className}}*
🗓️ Fecha: {{date}}
⏰ Horario: {{startTime}} - {{endTime}}
📍 Lugar: {{organization}}
📍 Dirección: {{address}}
💰 Valor: {{price}}
{{discount}}Si necesitas cancelar tu inscripción, responde a este mensaje y te ayudamos.

¡Te esperamos!`,

      // ⏳ Inscripción pendiente de aprobación
      classEnrollmentPending: `⏳ ¡Hola, {{names}}!

Hemos recibido tu solicitud de inscripción.

📚 Clase: *{{className}}*
🗓️ Fecha: {{date}}
⏰ Horario: {{startTime}} - {{endTime}}
📍 Lugar: {{organization}}
💰 Valor: {{price}}
{{discount}}Tu inscripción está *pendiente de aprobación*. Te notificaremos en cuanto sea confirmada.

Si tienes alguna pregunta, responde a este mensaje.`,

      // ❌ Inscripción cancelada
      classEnrollmentCancelled: `❌ ¡Hola, {{names}}!

Tu inscripción a la siguiente clase ha sido cancelada:

📚 Clase: *{{className}}*
🗓️ Fecha: {{date}}
⏰ Horario: {{startTime}} - {{endTime}}
📍 {{organization}}

Si deseas inscribirte en otra sesión o tienes alguna pregunta, responde a este mensaje y con gusto te ayudamos.`,
    };

    return templates[templateType] || '';
  },

  // ========================================
  // FUNCIONES DE RENDERIZADO
  // ========================================

  /**
   * Renderiza un template reemplazando placeholders con datos reales
   */
  renderTemplate: (template, data) => {
    let rendered = template;
    
    // Reemplazar cada variable en el template
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        rendered = rendered.replace(regex, value);
      }
    }
    
    // Limpiar placeholders que no fueron reemplazados (opcional)
    // rendered = rendered.replace(/{{[^}]+}}/g, '');
    
    return rendered;
  },

  /**
   * Obtiene el template a usar (personalizado o por defecto) y lo renderiza
   * @param {String|Object} organizationIdOrDoc - ID de organización o documento de organización
   * @param {String} templateType - Tipo de template a usar
   * @param {Object} data - Datos para renderizar el template
   */
  getRenderedTemplate: async (organizationIdOrDoc, templateType, data) => {
    try {
      // Obtener organizationId
      const organizationId = typeof organizationIdOrDoc === 'string' 
        ? organizationIdOrDoc 
        : organizationIdOrDoc?._id;

      console.log('🔍 [getRenderedTemplate] Buscando template:', {
        organizationId: organizationId?.toString(),
        templateType,
      });

      if (!organizationId) {
        console.warn('⚠️ No se proporcionó organizationId, usando template por defecto');
        const template = whatsappTemplates.getDefaultTemplate(templateType);
        return whatsappTemplates.renderTemplate(template, data);
      }

      // Buscar template personalizado en la colección
      const templateDoc = await WhatsappTemplate.findOne({ organizationId });
      console.log('📄 Template doc encontrado:', {
        found: !!templateDoc,
        hasCustomTemplate: !!templateDoc?.[templateType],
        templatePreview: templateDoc?.[templateType]?.substring(0, 50),
      });

      const customTemplate = templateDoc?.[templateType];
      
      // Usar personalizado si existe, sino el por defecto
      const template = customTemplate || whatsappTemplates.getDefaultTemplate(templateType);
      
      console.log('✅ Usando template:', customTemplate ? 'PERSONALIZADO' : 'POR DEFECTO');
      
      // Renderizar el template con los datos
      return whatsappTemplates.renderTemplate(template, data);
    } catch (error) {
      console.error('Error obteniendo template renderizado:', error);
      // En caso de error, usar template por defecto
      const template = whatsappTemplates.getDefaultTemplate(templateType);
      return whatsappTemplates.renderTemplate(template, data);
    }
  },

  // ========================================
  // FUNCIONES LEGACY (mantener compatibilidad)
  // ========================================

  scheduleAppointment: ({ names, date, organization, service, employee, cancellationLink }) => {
    let message = `📅 ¡Hola, ${names}! 

¡Tu cita ha sido agendada exitosamente!

🗓️ Fecha: ${date}
📍 Lugar: ${organization}
✨ Servicio: ${service}
👩‍💼 Te atenderá: ${employee}`;

    if (cancellationLink) {
      message += `\n\n❌ Si necesitas cancelar tu cita, puedes hacerlo desde este enlace:\n${cancellationLink}`;
    }

    message += `\n\nSi tienes alguna pregunta o necesitas modificar tu cita, *puedes responder directamente a este chat de WhatsApp*. Estamos atentos a ayudarte.\n\n¡Te esperamos pronto!`;

    return message;
  },

  scheduleAppointmentBatch: ({
    names,
    dateRange,
    organization,
    services,
    employee,
    cancellationLink,
  }) => {
    // services: [{ name, start, end }]
    const list = services
      .map((s, i) => `  ${i + 1}. ${s.name} (${s.start} – ${s.end})`)
      .join("\n");

    let message = `📅 ¡Hola, ${names}!

¡Tus citas han sido agendadas exitosamente!

🗓️ Fecha: ${dateRange}
📍 Lugar: ${organization}
✨ Servicios:
${list}
👩‍💼 Te atenderá: ${employee}`;

    if (cancellationLink) {
      message += `\n\n❌ Si necesitas cancelar tus citas, puedes hacerlo desde este enlace:\n${cancellationLink}`;
    }

    message += `\n\nSi necesitas ajustar horarios o cambiar algún servicio, *responde a este chat* y con gusto te ayudamos.\n\n¡Te esperamos!`;

    return message;
  },

  reminder: ({ names, date, organization, service, employee }) =>
    `📅 ¡Hola, ${names}!

Te recordamos que tienes una cita programada:

🗓️ Fecha: ${date}
📍 Lugar: ${organization}
✨ Servicio: ${service}
👩‍💼 Te atenderá: ${employee}

Por favor confirma tu cita *respondiendo a este chat de WhatsApp*.
Si no confirmas, podríamos asignar tu turno a otra persona en lista de espera.

¡Nos vemos pronto!`,

  statusReservationApproved: ({ names, date, organization, service, cancellationLink }) => {
    let message = `¡Hola, ${names}! 🎉

Tu reserva para el ${date} en ${organization} ha sido *aprobada*.

✨ Servicio: ${service}`;

    if (cancellationLink) {
      message += `\n\n❌ Si necesitas cancelar tu reserva, puedes hacerlo desde este enlace:\n${cancellationLink}`;
    }

    message += `\n\nSi tienes dudas o necesitas reprogramar, *responde a este chat de WhatsApp*. ¡Estamos para ayudarte!\n\n¡Te esperamos!`;

    return message;
  },

  statusReservationRejected: ({ names, date, organization }) =>
    `¡Hola, ${names}! 👋

Lamentamos informarte que tu reserva para el *${date}* en *${organization}* no pudo ser confirmada, ya que el horario seleccionado no está disponible.

Si deseas reprogramar o tienes alguna pregunta, simplemente responde a este mensaje de WhatsApp y con gusto te ayudaremos.

Gracias por tu comprensión. ¡Esperamos atenderte pronto! 😊`,
};

export default whatsappTemplates;
