/**
 * mpCountries.js
 *
 * Catálogo de países soportados por Mercado Pago para cobros cliente→org.
 *
 * Mercado Pago opera como SITIOS SEPARADOS por país (MCO, MLM, MLA...). Una
 * aplicación de MP se crea en un país concreto y solo puede conectar vendedores
 * y procesar pagos de ESE país, en SU moneda. Para operar en otro país hay que
 * registrar una aplicación de MP distinta en una cuenta de ese país y configurar
 * sus credenciales en `MP_<CC>_CLIENT_ID` / `MP_<CC>_CLIENT_SECRET` /
 * `MP_<CC>_PUBLIC_KEY` / `MP_<CC>_WEBHOOK_SECRET`.
 *
 * Un país está "habilitado" cuando existen sus env vars de credenciales.
 */

// Código de país ISO-3166 alfa-2 → { site (id de MP), currency (ISO 4217), name }.
export const MP_COUNTRIES = {
  CO: { site: "MCO", currency: "COP", name: "Colombia" },
  MX: { site: "MLM", currency: "MXN", name: "México" },
  AR: { site: "MLA", currency: "ARS", name: "Argentina" },
  CL: { site: "MLC", currency: "CLP", name: "Chile" },
  PE: { site: "MPE", currency: "PEN", name: "Perú" },
  UY: { site: "MLU", currency: "UYU", name: "Uruguay" },
  BR: { site: "MLB", currency: "BRL", name: "Brasil" },
};

/**
 * Normaliza un código de país a mayúsculas, con CO por defecto.
 */
export function normalizeCountry(country) {
  return String(country || "CO").toUpperCase();
}

/**
 * Devuelve la metadata del país (site/currency/name) o null si no está en el catálogo.
 */
export function getCountryMeta(country) {
  return MP_COUNTRIES[normalizeCountry(country)] || null;
}

/**
 * Moneda ISO 4217 esperada para un país (fallback COP).
 */
export function currencyForCountry(country) {
  return getCountryMeta(country)?.currency || "COP";
}

/**
 * ¿Hay credenciales de aplicación MP configuradas para este país?
 */
export function isCountryEnabled(country) {
  const cc = normalizeCountry(country);
  return !!(process.env[`MP_${cc}_CLIENT_ID`] && process.env[`MP_${cc}_CLIENT_SECRET`]);
}

/**
 * Lista de países habilitados (con env vars configuradas), con su metadata.
 */
export function enabledCountries() {
  return Object.keys(MP_COUNTRIES)
    .filter(isCountryEnabled)
    .map((cc) => ({ country: cc, ...MP_COUNTRIES[cc] }));
}

export default {
  MP_COUNTRIES,
  normalizeCountry,
  getCountryMeta,
  currencyForCountry,
  isCountryEnabled,
  enabledCountries,
};
