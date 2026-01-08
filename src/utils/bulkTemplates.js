// utils/bulkTemplates.js (agenda-backend)

export const messageTplReminder = `
📅 ¡Hola, {{names}}!

Recuerda que tienes {{count}} {{cita_pal}} {{agendada_pal}}.

🗓️ Fecha: {{date_range}}
📍 Lugar: {{organization}}

✨ Servicios:
{{services_list}}

👩‍💼 Te atenderá: {{employee}}

{{manage_block}}

Por favor confirma tu asistencia *respondiendo a este chat de WhatsApp*.
Si no puedes asistir, avísanos con anticipación para reprogramar tu turno.

¡Te esperamos!
`.trim();
