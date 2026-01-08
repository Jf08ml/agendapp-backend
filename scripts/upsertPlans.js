// scripts/upsertPlans.js
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import dbConnection from "../src/config/db.js";
import Plan from "../src/models/planModel.js";

// Load environment relative to backend dir
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(__dirname, `../.env.${process.env.NODE_ENV || "development"}`);
config({ path: envFile });

const plans = [
  {
    name: "Plan Básico",
    slug: "plan-basico",
    displayName: "Plan Básico (Subdominio)",
    price: 30000, // COP fallback
    prices: { USD: 10, COP: 30000 },
    billingCycle: "monthly",
    domainType: "subdomain",
    characteristics: [
      "Reservas ilimitadas y panel administrativo",
      "Landing de bienvenida + catálogo de servicios",
      "Gestión de clientes, agenda y caja",
      "Soporte básico por WhatsApp",
    ],
    limits: {
      maxEmployees: null,
      maxServices: null,
      maxAppointmentsPerMonth: null,
      maxStorageGB: 5,
      customBranding: false,
      whatsappIntegration: true,
      analyticsAdvanced: false,
      prioritySupport: false,
      autoReminders: false,
      autoConfirmations: false,
    },
    description:
      "Para empezar a digitalizar tu negocio. Incluye un subdominio, por ejemplo: tu-salon.agenditapp.com.",
    isActive: true,
  },
  {
    name: "Plan Esencial",
    slug: "plan-esencial",
    displayName: "Plan Esencial (Subdominio)",
    price: 50000, // COP fallback
    prices: { USD: 15, COP: 50000 },
    billingCycle: "monthly",
    domainType: "subdomain",
    characteristics: [
      "Todas las funcionalidades de AgenditApp",
      "Reservas ilimitadas y panel administrativo",
      "Landing de bienvenida + catálogo de servicios",
      "✨ Recordatorios automáticos por WhatsApp",
      "✨ Confirmaciones automáticas de reserva",
      "Gestión de clientes, agenda y caja",
      "Soporte básico por WhatsApp",
    ],
    limits: {
      maxEmployees: null,
      maxServices: null,
      maxAppointmentsPerMonth: null,
      maxStorageGB: 5,
      customBranding: false,
      whatsappIntegration: true,
      analyticsAdvanced: false,
      prioritySupport: false,
      autoReminders: true,
      autoConfirmations: true,
    },
    description:
      "Ideal si quieres automatizar y ahorrar tiempo. Incluye subdominio y recordatorios automáticos.",
    isActive: true,
  },
  {
    name: "Plan Marca Propia",
    slug: "plan-marca-propia",
    displayName: "Plan Marca Propia (Dominio)",
    price: 100000, // COP fallback
    prices: { USD: 30, COP: 100000 },
    billingCycle: "monthly",
    domainType: "custom_domain",
    characteristics: [
      "Todas las funcionalidades de AgenditApp",
      "Reservas ilimitadas y panel administrativo",
      "Landing de bienvenida con tu dominio propio",
      "✨ Recordatorios automáticos por WhatsApp",
      "✨ Confirmaciones automáticas de reserva",
      "Configuración y soporte para el dominio",
      "Soporte prioritario por WhatsApp",
    ],
    limits: {
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
    },
    description:
      "Para negocios que quieren reforzar su marca y presencia digital. Incluye dominio propio y soporte prioritario.",
    isActive: true,
  },
];

async function upsertPlans() {
  try {
    await dbConnection();
    console.log("\n✓ Conectado a la base de datos");

    for (const plan of plans) {
      const updated = await Plan.findOneAndUpdate(
        { slug: plan.slug },
        { $set: plan },
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
