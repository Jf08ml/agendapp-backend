const whatsappTemplates = {
  scheduleAppointment: ({ names, date, organization, service, employee }) =>
    `📅 ¡Hola, ${names}! 

¡Tu cita ha sido agendada exitosamente!

🗓️ Fecha: ${date}
📍 Lugar: ${organization}
✨ Servicio: ${service}
👩‍💼 Te atenderá: ${employee}

Si tienes alguna pregunta o necesitas modificar tu cita, *puedes responder directamente a este chat de WhatsApp*. Estamos atentos a ayudarte.

¡Te esperamos pronto!`,

  scheduleAppointmentBatch: ({
    names,
    dateRange,
    organization,
    services,
    employee,
  }) => {
    // services: [{ name, start, end }]
    const list = services
      .map((s, i) => `  ${i + 1}. ${s.name} (${s.start} – ${s.end})`)
      .join("\n");

    return `📅 ¡Hola, ${names}!

¡Tus citas han sido agendadas exitosamente!

🗓️ Fecha: ${dateRange}
📍 Lugar: ${organization}
✨ Servicios:
${list}
👩‍💼 Te atenderá: ${employee}

Si necesitas ajustar horarios o cambiar algún servicio, *responde a este chat* y con gusto te ayudamos.

¡Te esperamos!`;
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

  statusReservationApproved: ({ names, date, organization, service }) =>
    `¡Hola, ${names}! 🎉

Tu reserva para el ${date} en ${organization} ha sido *aprobada*.

✨ Servicio: ${service}

Si tienes dudas o necesitas reprogramar, *responde a este chat de WhatsApp*. ¡Estamos para ayudarte!

¡Te esperamos!`,

  statusReservationRejected: ({ names, date, organization }) =>
    `¡Hola, ${names}! 👋

Lamentamos informarte que tu reserva para el *${date}* en *${organization}* no pudo ser confirmada, ya que el horario seleccionado no está disponible.

Si deseas reprogramar o tienes alguna pregunta, simplemente responde a este mensaje de WhatsApp y con gusto te ayudaremos.

Gracias por tu comprensión. ¡Esperamos atenderte pronto! 😊`,
};

export default whatsappTemplates;
