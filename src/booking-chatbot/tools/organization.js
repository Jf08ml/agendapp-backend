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

// Etiquetas legibles de Organization.paymentMethods[].type.
const PAYMENT_METHOD_LABELS = {
  nequi: "Nequi",
  bancolombia: "Bancolombia",
  daviplata: "Daviplata",
  mercado_pago: "Mercado Pago",
  pix: "Pix",
  yape: "Yape",
  sinpe: "SINPE",
  transferencia_bancaria: "Transferencia bancaria",
  efectivo: "Efectivo",
  otros: "Otro medio",
};

// Datos para transferir (cuentas de Organization.paymentMethods, los mismos que
// muestra la página pública /pago/comprobante) en formato WhatsApp, o null si el
// negocio no tiene cuentas registradas. Caso real (Diana Vargas, nov-2026): 6 de
// 10 abonos vencieron sin pagar y varias clientas pedían "el número de cuenta" por
// el chat — el bot solo les repetía el enlace.
export const transferDetailsText = (organization) => {
  const blocks = (organization.paymentMethods || [])
    .filter((m) => m.type !== "efectivo" && (m.accountNumber || m.phoneNumber))
    .map((m) => {
      const lines = [`*${PAYMENT_METHOD_LABELS[m.type] || "Cuenta"}*`];
      if (m.accountNumber) lines.push(`Cuenta: ${m.accountNumber}`);
      if (m.phoneNumber) lines.push(`Número: ${m.phoneNumber}`);
      if (m.accountName) lines.push(`Titular: ${m.accountName}`);
      if (m.notes) lines.push(m.notes);
      return lines.join("\n");
    });
  return blocks.length ? blocks.join("\n\n") : null;
};

export const getOrganizationInfo = {
  name: "get_organization_info",
  description:
    "Obtiene la dirección, horario de atención, teléfono/WhatsApp, redes sociales y medios de pago registrados del negocio. Úsala cuando el cliente pregunte por la dirección, cómo llegar, a qué hora abren/cierran, el contacto o cómo se puede pagar — nunca inventes esta información sin llamar la tool primero.",
  parameters: {},
  handler: async (_params, { organization, channel }) => {
    const hours = formatWeeklySchedule(organization.weeklySchedule);
    const { lat, lng } = organization.location || {};
    // En WhatsApp el cliente ya le escribe al número del negocio: si es el mismo,
    // no se le ofrece como "contacto directo" (el bot lo hacía en vez de pasar
    // el mensaje al equipo).
    const last10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);
    const isSameNumber =
      channel === "whatsapp" &&
      !!organization.phoneNumber &&
      last10(organization.phoneNumber) === last10(organization.metaPhone);

    return {
      businessName: organization.name,
      address: organization.address || null,
      mapsUrl: lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : null,
      hours: hours || null,
      phone: isSameNumber ? null : organization.phoneNumber || null,
      whatsapp: isSameNumber ? null : organization.whatsappUrl || null,
      ...(isSameNumber
        ? { contactNote: "El cliente ya está escribiendo al WhatsApp del negocio: no le des otro contacto. Si necesita a una persona, usa [[HANDOFF]]." }
        : {}),
      instagram: organization.instagramUrl || null,
      facebook: organization.facebookUrl || null,
      paymentMethods: [
        ...new Set(
          (organization.paymentMethods || [])
            .map((m) => PAYMENT_METHOD_LABELS[m.type])
            .filter(Boolean)
        ),
      ],
      // Cuentas para transferir: si el cliente pregunta a dónde/cómo transferir, dáselas tal cual.
      transferDetails: transferDetailsText(organization),
      _instruction:
        !organization.address && !hours
          ? "Este negocio no tiene dirección ni horario configurados en el sistema. Dile al cliente que no tienes esa información disponible por ahora — NUNCA inventes una dirección u horario."
          : "Usa exactamente estos datos. Si algún campo específico es null, dilo con naturalidad (ej. 'no tengo el Instagram registrado') en vez de inventarlo o de omitir la respuesta.",
    };
  },
};
