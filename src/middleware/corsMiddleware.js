import organizationModel from "../models/organizationModel.js";

const MAIN_DOMAIN = "agenditapp.com";
// Regex: cualquier subdominio de agenditapp.com (http o https)
const WILDCARD_REGEX = /^https?:\/\/([a-z0-9][a-z0-9-]*[a-z0-9])?\.?agenditapp\.com$/;

/**
 * Verifica si un origin pertenece a *.agenditapp.com
 */
function isAgenditappOrigin(origin) {
  if (!origin) return false;
  return WILDCARD_REGEX.test(origin);
}

/**
 * Verifica si un origin es un dominio custom registrado en la BD.
 * Consulta por request (serverless-safe, sin caché en memoria).
 */
async function isCustomDomainOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    const org = await organizationModel
      .findOne({ domains: hostname })
      .select("_id")
      .lean();
    return !!org;
  } catch {
    return false;
  }
}

/**
 * Middleware de CORS dinámico para plataforma multitenant (serverless-safe).
 *
 * - *.agenditapp.com → permitido por regex (sin BD)
 * - Custom domains → consulta BD por request
 * - localhost → permitido en dev
 * - Sin origin → permitido (mobile, Postman, webhooks)
 * - Refleja origin exacto (no *), con Vary: Origin
 */
export const dynamicCorsOptions = {
  origin: async (origin, callback) => {
    // Sin origin → permitir (mobile apps, Postman, webhooks, server-to-server)
    if (!origin) {
      return callback(null, true);
    }

    // *.agenditapp.com → permitir por regex (sin BD lookup)
    if (isAgenditappOrigin(origin)) {
      return callback(null, origin); // Reflejar origin exacto
    }

    // Localhost en desarrollo
    if (process.env.NODE_ENV !== "production") {
      try {
        const url = new URL(origin);
        if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
          return callback(null, origin);
        }
      } catch {
        // Ignore parse error
      }
    }

    // Custom domains → consulta BD
    const isCustom = await isCustomDomainOrigin(origin);
    if (isCustom) {
      return callback(null, origin); // Reflejar origin exacto
    }

    console.warn(`⚠️ CORS bloqueado para origin: ${origin}`);
    callback(new Error(`Origin ${origin} no permitido por CORS`));
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Dev-Tenant-Slug", // Solo funciona en dev (backend ignora en prod)
  ],
};
