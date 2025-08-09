const whatsappTemplates = {
  scheduleAppointment: ({
    names,
    date,
    organization,
    service,
    employee,
  }) =>
    `📅 ¡Hola, ${names}! 

¡Tu cita ha sido agendada exitosamente!

🗓️ Fecha: ${date}
📍 Lugar: ${organization}
✨ Servicio: ${service}
👩‍💼 Te atenderá: ${employee}

Si tienes alguna pregunta o necesitas modificar tu cita, *puedes responder directamente a este chat de WhatsApp*. Estamos atentos a ayudarte.

¡Te esperamos pronto!`,

  reminder: ({ names, date, organization, service, employee }) =>
    `📅 ¡Hola, ${names}!

Te recordamos que tienes una cita programada:

🗓️ Fecha: ${date}
📍 Lugar: ${organization}
✨ Servicio: ${service}
👩‍💼 Te atenderá: ${employee}

Por favor confirma tu cita *respondiendo a este chat de WhatsApp*.

¡Nos vemos pronto!`,

  statusReservationApproved: ({
    names,
    date,
    organization,
    service,
  }) =>
    `¡Hola, ${names}! 🎉

Tu reserva para el ${date} en ${organization} ha sido *aprobada*.

✨ Servicio: ${service}

Si tienes dudas o necesitas reprogramar, *responde a este chat de WhatsApp*. ¡Estamos para ayudarte!

¡Te esperamos!`,

  statusReservationRejected: ({ names, date, organization }) =>
    `¡Hola, ${names}!

Lo lamentamos mucho, pero tu reserva para el ${date} en ${organization} no pudo ser aceptada porque el horario seleccionado no está disponible.

Si tienes preguntas o deseas reprogramar, *responde a este chat de WhatsApp*. 

Esperamos poder atenderte pronto. ¡Gracias por tu comprensión!`,
};

export default whatsappTemplates;
