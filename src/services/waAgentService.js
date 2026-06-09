// Baileys es solo canal de notificaciones — no procesa comandos del admin.
// Los comandos al bot se envían vía Meta (admin escribe al número de AgenditApp).

// Limpia sufijos de JID de Baileys: @s.whatsapp.net, @lid, @c.us, etc.
export function sanitizePhone(jid) {
  return jid ? jid.replace(/@.+$/, "") : jid;
}

// Normaliza un número local a E.164 asumiendo Colombia (+57)
export function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("57") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+57${digits}`;
  return `+${digits}`;
}

// Mensajes de Baileys — no se procesan (Baileys = solo notificaciones salientes)
export function processIncomingMessage() {
  return;
}
