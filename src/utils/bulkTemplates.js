// utils/bulkTemplates.js (agenda-backend)

export const messageTplReminder = `
📅 ¡Hola, {{names}}!

Recuerda que tienes {{count}} {{cita_pal}} {{agendada_pal}}.

🗓️ Fecha: {{date_range}}
📍 Lugar: {{organization}}
📍 Dirección: {{address}}

✨ Servicios:
{{services_list}}

👩‍💼 Te atenderá: {{employee}}

Gestiona tu cita desde el siguiente enlace:
{{manage_block}}

Por favor confirma tu asistencia o cancela tu cita desde el enlace.
Si necesitas ayuda, puedes responder a este mensaje.

💖 ¡Te esperamos!
`.trim();
