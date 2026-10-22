// scripts/upsertPlans.js
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import dbConnection from "../src/config/db.js";
import Plan from "../src/models/planModel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(__dirname, `../.env.${process.env.NODE_ENV || "development"}`);
config({ path: envFile });

// Límites compartidos para planes que tienen acceso completo a WA + clases + paquetes
const FULL_LIMITS = {
  maxEmployees: null,
  maxServices: null,
  maxAppointmentsPerMonth: null,
  maxStorageGB: 20,
  customBranding: true,
  whatsappIntegration: true,
  analyticsAdvanced: true,
  prioritySupport: true,
  autoReminders: true,
  autoConfirmations: true,
  servicePackages: true,
  campaignsWhatsapp: true,
  classesModule: true,
  loyaltyProgram: true,
  professionalLanding: true,
  brandingVisible: false,
  maxRemindersPerAppointment: 2,
};

const plans = [
  // ─── NUEVO: Plan Gratuito ────────────────────────────────────────────────
  {
    slug: "plan-gratuito",
    name: "Plan Gratuito",
    displayName: "Plan Gratuito",
    price: 0,
    currency: "USD",
    billingCycle: "monthly",
    domainType: "subdomain",
    description: "Ideal para personas que quieren probar AgenditApp sin costo.",
    characteristics: [
      "1 profesional",
      "Hasta 5 servicios",
      "Clientes ilimitados",
      "Reservas online (manual y automática)",
      "Agenda virtual semanal y mensual",
      "Gestión básica de ingresos",
      "Analíticas básicas",
      "Subdominio tunegocio.agenditapp.com",
      "Branding AgenditApp visible",
    ],
    limits: {
      maxEmployees: 1,
      maxServices: 5,
      maxAppointmentsPerMonth: null,
      maxStorageGB: 2,
      customBranding: false,
      whatsappIntegration: false,
      analyticsAdvanced: true,
      prioritySupport: false,
      autoReminders: false,
      autoConfirmations: false,
      servicePackages: false,
      campaignsWhatsapp: false,
      classesModule: false,
      loyaltyProgram: false,
      professionalLanding: false,
      brandingVisible: true,
      maxRemindersPerAppointment: 0,
    },
    isActive: true,
  },

  // ─── EDITAR IN-PLACE: Plan Básico → Starter (renovado oct-2026) ──────────
  // Plan de entrada para quien trabaja solo: 1 profesional y WhatsApp
  // automático (confirmación + 1 recordatorio) con tope de 50 citas al mes
  // (services/waQuotaService.js). Pasado el tope la agenda sigue igual; solo
  // dejan de salir los mensajes → el paso natural es el Esencial.
  // ⚠️ El precio cobrado vive en la pasarela (payment.productId / lsVariantId):
  // actualizarlo allí ANTES de correr este script.
  {
    slug: "plan-starter", // era "plan-basico"; el editor del superadmin lo regeneró al renombrarlo (oct-2026)
    name: "Plan Starter",
    displayName: "Plan Starter",
    price: 12,
    currency: "USD",
    billingCycle: "monthly",
    domainType: "subdomain",
    description: "Ideal para quien trabaja solo y está empezando.",
    characteristics: [
      "1 profesional",
      "Servicios y clientes ilimitados",
      "Reservas online",
      "Agenda virtual completa",
      "WhatsApp automático: confirmación y 1 recordatorio por cita",
      "Hasta 50 citas al mes con WhatsApp",
      "Gestión de caja, ingresos y gastos",
      "Sistema de fidelización (servicios y referidos)",
      "Subdominio tunegocio.agenditapp.com",
    ],
    limits: {
      maxEmployees: 1,
      maxServices: null,
      maxAppointmentsPerMonth: null,
      maxStorageGB: 5,
      customBranding: true,
      whatsappIntegration: true,
      analyticsAdvanced: true,
      prioritySupport: false,
      autoReminders: true,
      autoConfirmations: true,
      servicePackages: false,
      campaignsWhatsapp: false,
      classesModule: false,
      loyaltyProgram: true,
      professionalLanding: false,
      brandingVisible: false,
      maxRemindersPerAppointment: 1,
      maxWhatsappAppointmentsPerMonth: 50,
    },
    isActive: true,
  },

  // ─── EDITAR IN-PLACE: Plan Esencial ─────────────────────────────────────
  {
    slug: "plan-esencial",
    name: "Plan Esencial",
    displayName: "Plan Esencial",
    price: 20,
    currency: "USD",
    billingCycle: "monthly",
    domainType: "subdomain",
    description: "Ideal para negocios que quieren reducir ausencias y ahorrar tiempo.",
    characteristics: [
      "Todo lo del Plan Starter",
      "Profesionales ilimitados",
      "WhatsApp automático sin tope de citas",
      "1 recordatorio automático por cita",
      "Confirmación de cita",
      "Nueva cita agendada",
      "Primer recordatorio",
      "Agradecimiento de confirmación",
      "Aviso de cancelación / no asistencia",
      "Mensajes de fidelización y referidos",
      "Subdominio tunegocio.agenditapp.com",
    ],
    limits: {
      maxEmployees: null,
      maxServices: null,
      maxAppointmentsPerMonth: null,
      maxStorageGB: 5,
      customBranding: true,
      whatsappIntegration: true,
      analyticsAdvanced: true,
      prioritySupport: false,
      autoReminders: true,
      autoConfirmations: true,
      servicePackages: false,
      campaignsWhatsapp: false,
      classesModule: false,
      loyaltyProgram: true,
      professionalLanding: false,
      brandingVisible: false,
      maxRemindersPerAppointment: 1,
    },
    isActive: true,
  },

  // ─── EDITAR IN-PLACE: Plan Marca Propia → Marca/Pro ─────────────────────
  {
    slug: "plan-marca-propia",
    name: "Plan Marca/Pro",
    displayName: "Plan Marca/Pro",
    price: 30,
    currency: "USD",
    billingCycle: "monthly",
    domainType: "custom_domain",
    description: "Ideal para negocios que buscan imagen profesional y herramientas avanzadas.",
    characteristics: [
      "Todo lo del Plan Esencial",
      "2 recordatorios automáticos por cita",
      "Campañas masivas por WhatsApp",
      "Landing profesional premium",
      "Módulo de clases grupales",
      "Módulo de paquetes y sesiones",
      "Dominio propio: tunegocio.com",
      "Soporte prioritario",
    ],
    limits: {
      ...FULL_LIMITS,
      domainType: "custom_domain",
    },
    isActive: true,
  },

  // ─── Plan Demo (trial interno) ───────────────────────────────────────────
  {
    slug: "plan-demo",
    name: "Plan Demo",
    displayName: "Plan Demo (Interno)",
    price: 0,
    currency: "USD",
    billingCycle: "monthly",
    domainType: "subdomain",
    description: "Plan interno para trial de 30 días. Acceso total sin restricciones.",
    characteristics: [
      "Acceso completo a todas las funcionalidades",
      "Sin límites de empleados, servicios o citas",
      "Recordatorios y confirmaciones automáticas",
      "Analíticas avanzadas",
      "Paquetes de sesiones",
      "Módulo de clases",
    ],
    limits: {
      ...FULL_LIMITS,
      domainType: "subdomain",
    },
    isActive: true,
  },

  // ─── Legacy inactivo: agregar nuevos campos ──────────────────────────────
  {
    slug: "plan-esencial-subdominio-legacy",
    // Solo actualizamos los límites nuevos, sin tocar el resto
    limits_patch: {
      campaignsWhatsapp: false,
      classesModule: false,
      servicePackages: false,
      loyaltyProgram: true,
      professionalLanding: false,
      brandingVisible: false,
      maxRemindersPerAppointment: 1,
      analyticsAdvanced: true,
    },
  },
];

async function upsertPlans() {
  try {
    await dbConnection();
    console.log("\n✓ Conectado a la base de datos\n");

    for (const plan of plans) {
      const { slug, limits_patch, ...planData } = plan;

      if (limits_patch) {
        // Solo parchear límites específicos (plan legacy)
        const updateFields = {};
        for (const [key, value] of Object.entries(limits_patch)) {
          updateFields[`limits.${key}`] = value;
        }
        const updated = await Plan.findOneAndUpdate(
          { slug },
          { $set: updateFields },
          { new: true }
        );
        if (updated) {
          console.log(`- Patch límites legacy: ${updated.displayName} [${slug}]`);
        } else {
          console.log(`⚠ No encontrado para patch: ${slug}`);
        }
        continue;
      }

      const updated = await Plan.findOneAndUpdate(
        { slug },
        { $set: planData },
        { upsert: true, new: true }
      );
      console.log(`- Upsert: ${updated.displayName} [${updated.slug}]`);
    }

    console.log("\n✅ Upsert de planes completado.");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Error en upsert de planes:", err);
    process.exit(1);
  }
}

upsertPlans();
