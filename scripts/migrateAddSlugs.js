// scripts/migrateAddSlugs.js
// Genera slugs para organizaciones existentes que no tienen slug.
// Prioridad: extraer del subdominio existente en domains[] → slugify del nombre.
// NO modifica domains[] — solo agrega el campo slug.
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import dbConnection from "../src/config/db.js";
import Organization from "../src/models/organizationModel.js";
import { RESERVED_SLUGS } from "../src/utils/reservedSlugs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(__dirname, `../.env.${process.env.NODE_ENV || "development"}`);
config({ path: envFile });

const MAIN_DOMAIN = "agenditapp.com";

/**
 * Extrae el slug del subdominio de agenditapp.com en domains[].
 * Ej: "meraki.agenditapp.com" → "meraki"
 * Normaliza: quita guiones, puntos, números — solo letras minúsculas.
 */
function extractSlugFromDomains(domains) {
  if (!domains || !Array.isArray(domains)) return null;

  for (const domain of domains) {
    if (domain.endsWith(`.${MAIN_DOMAIN}`)) {
      const subdomain = domain.slice(0, -(MAIN_DOMAIN.length + 1));
      // Normalizar: solo letras minúsculas
      const slug = subdomain.toLowerCase().replace(/[^a-z]/g, "");
      if (slug && slug.length >= 3 && slug !== "www" && slug !== "registro") {
        return slug;
      }
    }
  }
  return null;
}

/**
 * Genera slug solo con letras minúsculas (sin guiones, puntos, números).
 */
function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z]/g, "") // Keep only lowercase letters
    .slice(0, 63);
}

async function isSlugTaken(slug, excludeOrgId) {
  if (RESERVED_SLUGS.includes(slug)) return true;
  const existing = await Organization.findOne({
    slug,
    _id: { $ne: excludeOrgId },
  }).select("_id").lean();
  return !!existing;
}

async function generateUniqueSlug(baseName, excludeOrgId) {
  let slug = slugify(baseName);
  if (!slug || slug.length < 3) {
    slug = "org";
  }

  if (!(await isSlugTaken(slug, excludeOrgId))) return slug;

  // Try appending letter suffixes (a, b, c, ... aa, ab, ...)
  const letters = "abcdefghijklmnopqrstuvwxyz";
  for (let i = 0; i < 26; i++) {
    const candidate = `${slug}${letters[i]}`;
    if (candidate.length <= 63 && !(await isSlugTaken(candidate, excludeOrgId))) {
      return candidate;
    }
  }
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const candidate = `${slug}${letters[i]}${letters[j]}`;
      if (candidate.length <= 63 && !(await isSlugTaken(candidate, excludeOrgId))) {
        return candidate;
      }
    }
  }

  // Fallback: random letter suffix
  const random = Array.from({ length: 6 }, () => letters[Math.floor(Math.random() * 26)]).join("");
  return `${slug.slice(0, 57)}${random}`;
}

async function migrate() {
  try {
    await dbConnection();
    console.log("\n✓ Conectado a la base de datos");

    // Buscar orgs sin slug
    const orgsWithoutSlug = await Organization.find({
      $or: [{ slug: { $exists: false } }, { slug: null }, { slug: "" }],
    }).select("_id name domains");

    console.log(`\nOrganizaciones sin slug: ${orgsWithoutSlug.length}`);

    if (orgsWithoutSlug.length === 0) {
      console.log("✅ Todas las organizaciones ya tienen slug");
      process.exit(0);
    }

    let migrated = 0;
    let errors = 0;

    for (const org of orgsWithoutSlug) {
      try {
        // Prioridad 1: extraer del subdominio existente en domains[]
        let slug = extractSlugFromDomains(org.domains);
        let source = "subdominio";

        // Prioridad 2: generar del nombre
        if (!slug || (await isSlugTaken(slug, org._id))) {
          slug = await generateUniqueSlug(org.name, org._id);
          source = "nombre";
        }

        await Organization.updateOne({ _id: org._id }, { $set: { slug } });
        console.log(`  ✅ ${org.name} → ${slug} (desde ${source})`);
        migrated++;
      } catch (err) {
        console.error(`  ❌ ${org.name}: ${err.message}`);
        errors++;
      }
    }

    console.log(`\n✅ Migración completada: ${migrated} exitosas, ${errors} errores`);
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Error en migración:", err);
    process.exit(1);
  }
}

migrate();
