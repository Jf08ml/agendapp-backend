const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// Convierte el weeklySchedule de la organización en líneas legibles ("lunes: 08:00–20:00").
// Devuelve null si el negocio no tiene horario semanal habilitado.
const formatWeeklySchedule = (weeklySchedule) => {
  if (!weeklySchedule?.enabled || !weeklySchedule?.schedule?.length) return null;
  return weeklySchedule.schedule
    .slice()
    .sort((a, b) => a.day - b.day)
    .map((d) => (d.isOpen ? `${DAY_NAMES[d.day]}: ${d.start}–${d.end}` : `${DAY_NAMES[d.day]}: cerrado`));
};

export const getOrganizationInfo = {
  name: "get_organization_info",
  description:
    "Obtiene la dirección, horario de atención, teléfono/WhatsApp y redes sociales del negocio. Úsala cuando el cliente pregunte por la dirección, cómo llegar, a qué hora abren/cierran, o el contacto del negocio — nunca inventes esta información sin llamar la tool primero.",
  parameters: {},
  handler: async (_params, { organization }) => {
    const hours = formatWeeklySchedule(organization.weeklySchedule);
    const { lat, lng } = organization.location || {};

    return {
      businessName: organization.name,
      address: organization.address || null,
      mapsUrl: lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : null,
      hours: hours || null,
      phone: organization.phoneNumber || null,
      whatsapp: organization.whatsappUrl || null,
      instagram: organization.instagramUrl || null,
      facebook: organization.facebookUrl || null,
      _instruction:
        !organization.address && !hours
          ? "Este negocio no tiene dirección ni horario configurados en el sistema. Dile al cliente que no tienes esa información disponible por ahora — NUNCA inventes una dirección u horario."
          : "Usa exactamente estos datos. Si algún campo específico es null, dilo con naturalidad (ej. 'no tengo el Instagram registrado') en vez de inventarlo o de omitir la respuesta.",
    };
  },
};
