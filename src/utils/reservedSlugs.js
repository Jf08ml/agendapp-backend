import Organization from "../models/organizationModel.js";

export const RESERVED_SLUGS = [
  "app",
  "www",
  "api",
  "admin",
  "superadmin",
  "login",
  "signup",
  "register",
  "mail",
  "smtp",
  "ftp",
  "blog",
  "help",
  "support",
  "status",
  "docs",
  "dev",
  "staging",
  "test",
  "demo",
  "cdn",
  "assets",
  "static",
  "ns1",
  "ns2",
];

const SLUG_REGEX = /^[a-z]{3,63}$/;

/**
 * Valida formato de slug: 3-63 chars, solo letras minúsculas.
 * Sin números, guiones, puntos ni mayúsculas.
 */
export function isValidSlug(slug) {
  if (!slug || typeof slug !== "string") return false;
  return SLUG_REGEX.test(slug);
}

/**
 * Verifica si un slug está disponible (no reservado y no existe en BD).
 * Retorna { available, reason? }
 */
export async function isSlugAvailable(slug) {
  const normalized = slug?.toLowerCase().trim();

  if (!isValidSlug(normalized)) {
    return { available: false, reason: "invalid_format" };
  }

  if (RESERVED_SLUGS.includes(normalized)) {
    return { available: false, reason: "reserved" };
  }

  const existing = await Organization.findOne({ slug: normalized }).select("_id").lean();
  if (existing) {
    return { available: false, reason: "taken" };
  }

  return { available: true };
}

/**
 * Genera sugerencias de slug alternativas (máx 3).
 */
const SUGGESTION_SUFFIXES = ["app", "pro", "hub", "now", "plus", "site", "web"];

export async function suggestSlugs(baseSlug, maxSuggestions = 3) {
  const suggestions = [];
  for (const suffix of SUGGESTION_SUFFIXES) {
    if (suggestions.length >= maxSuggestions) break;
    const candidate = `${baseSlug}${suffix}`;
    if (isValidSlug(candidate) && !RESERVED_SLUGS.includes(candidate)) {
      const existing = await Organization.findOne({ slug: candidate }).select("_id").lean();
      if (!existing) {
        suggestions.push(candidate);
      }
    }
  }
  return suggestions;
}
