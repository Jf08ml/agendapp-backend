// utils/bulkTemplates.js (agenda-backend)

export const messageTplReminder = `
📅 ¡Hola, {{names}}!

Tienes {{count}} {{cita_pal}} {{agendada_pal}} para hoy.

🗓️ Franja: {{date_range}}
📍 Lugar: {{organization}}

✨ Servicios:
{{services_list}}

👩‍💼 Te atenderá: {{employee}}

Por favor confirma tu asistencia *respondiendo a este chat de WhatsApp*.
Si no puedes asistir, avísanos con anticipación para reprogramar tu turno.

¡Te esperamos!
`.trim();
