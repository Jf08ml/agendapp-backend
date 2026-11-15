// Fuera de producción, los correos y WhatsApp automáticos a dueños de negocio
// solo salen hacia los destinatarios de DEV_NOTIFY_ALLOWLIST (correos y/o
// teléfonos separados por coma). .env.development apunta a la base de
// producción, así que sin esta guardia una prueba local podría escribirle a un
// cliente real.

const digits = (v) => String(v ?? "").replace(/\D/g, "");

/**
 * @param {string} recipient - correo o teléfono
 * @param {{ nodeEnv?: string, allowlist?: string }} [env] - inyectable para pruebas
 * @returns {boolean}
 */
export function isRecipientAllowed(recipient, env = {}) {
  const nodeEnv = env.nodeEnv ?? process.env.NODE_ENV;
  if (nodeEnv === "production") return true;
  if (!recipient) return false;

  const entries = String(env.allowlist ?? process.env.DEV_NOTIFY_ALLOWLIST ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  const value = String(recipient).trim();
  if (value.includes("@")) {
    const email = value.toLowerCase();
    return entries.some((e) => e.toLowerCase() === email);
  }
  const phone = digits(value);
  return phone.length > 0 && entries.some((e) => !e.includes("@") && digits(e) === phone);
}
