import organizationModel from "../models/organizationModel.js";

const MAIN_DOMAIN = "agenditapp.com";
const SIGNUP_SUBDOMAIN = "app";
const SUBDOMAIN_REGEX = /^([a-z0-9][a-z0-9-]{1,61}[a-z0-9])$/;

/**
 * Normaliza hostname: toma primer valor si es lista, trim, lowercase, strip port.
 */
function normalizeHostname(raw) {
  if (!raw) return null;
  // x-forwarded-host puede venir como "a.com, b.com"
  const first = raw.split(",")[0].trim().toLowerCase();
  // Quitar puerto si existe
  return first.split(":")[0];
}

/**
 * Extrae slug de un subdominio de agenditapp.com.
 * Ej: "miempresa.agenditapp.com" → "miempresa"
 * Retorna null si no coincide con el patrón.
 */
function extractSlugFromHost(hostname) {
  if (!hostname || !hostname.endsWith(`.${MAIN_DOMAIN}`)) return null;
  const slug = hostname.slice(0, -(MAIN_DOMAIN.length + 1)); // quita ".agenditapp.com"
  if (slug === "www" || slug === SIGNUP_SUBDOMAIN) return null;
  if (!SUBDOMAIN_REGEX.test(slug)) return null;
  return slug;
}

export async function organizationResolver(req, res, next) {
  // Saltar para rutas que no necesitan organización
  if (
    req.path.startsWith("/cron/") ||
    req.path.startsWith("/payments") ||
    req.path.startsWith("/billing/public") ||
    req.path.startsWith("/public") ||
    req.path.startsWith("/register") ||
    req.path.startsWith("/exchange") ||
    req.path.startsWith("/check-slug")
  ) {
    return next();
  }

  // 1. Dev override (solo NODE_ENV !== "production")
  if (process.env.NODE_ENV !== "production") {
    const devSlug = req.headers["x-dev-tenant-slug"] || req.query.slug;
    if (devSlug) {
      const org = await organizationModel
        .findOne({ slug: devSlug.toLowerCase().trim() })
        .populate("role");
      if (org) {
        req.organization = org;
        return next();
      }
      // Si el slug dev no existe, fallback a resolución normal
    }
  }

  // 2. Resolver hostname
  const hostname = normalizeHostname(
    req.headers["x-forwarded-host"] || req.headers.host
  );

  if (!hostname) {
    return res.status(400).json({ error: "No se pudo determinar el dominio del cliente" });
  }

  // 3. app.agenditapp.com → skip (signup domain, no tenant)
  if (hostname === `${SIGNUP_SUBDOMAIN}.${MAIN_DOMAIN}`) {
    return next();
  }

  // 4. {slug}.agenditapp.com → buscar por slug
  const slug = extractSlugFromHost(hostname);
  if (slug) {
    const org = await organizationModel.findOne({ slug }).populate("role");
    if (!org) {
      return res.status(404).json({
        error: `Organización no encontrada para el subdominio ${slug}`,
        code: "ORG_NOT_FOUND",
      });
    }
    req.organization = org;
    return next();
  }

  // 5. Custom domain → buscar por domains[]
  const org = await organizationModel
    .findOne({ domains: hostname })
    .populate("role");

  if (!org) {
    return res.status(404).json({
      error: `Organización no encontrada para el dominio ${hostname}`,
      code: "ORG_NOT_FOUND",
    });
  }

  req.organization = org;
  next();
}
