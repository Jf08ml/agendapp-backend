// scripts/seedPlans.js
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV}` });

import dbConnection from "../src/config/db.js";
import planModel from "../src/models/planModel.js";

const defaultPlans = [
  {
    name: "Plan Básico",
    slug: "plan-basico",
    displayName: "Plan Básico",
    price: 10,
    currency: "USD",
    billingCycle: "monthly",
    domainType: "subdomain",
    characteristics: [
      "Reservas ilimitadas y panel administrativo",
      "Landing de bienvenida + catálogo de servicios",
      "Gestión de clientes, agenda y caja",
      "Soporte básico por WhatsApp"
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
    description: "Para empezar a digitalizar tu negocio sin complicaciones. Incluye subdominio gratuito y herramientas esenciales para gestionar reservas, clientes y agenda.",
    isActive: true,
  },
  {
    name: "Plan Esencial",
    slug: "plan-esencial",
    displayName: "Plan Esencial",
    price: 15,
    currency: "USD",
    billingCycle: "monthly",
    domainType: "subdomain",
    characteristics: [
      "Todas las funciones del Plan Básico",
      "Recordatorios automáticos por WhatsApp",
      "Confirmaciones automáticas de reserva",
      "Subdominio incluido",
      "Soporte básico por WhatsApp"
    ],
    limits: {
      maxEmployees: null,
      maxServices: null,
      maxAppointmentsPerMonth: null,
      maxStorageGB: 10,
      customBranding: false,
      whatsappIntegration: true,
      analyticsAdvanced: false,
      prioritySupport: false,
      autoReminders: true,
      autoConfirmations: true,
    },
    description: "Ideal para automatizar procesos y reducir ausencias con mensajes automáticos.",
    isActive: true,
    featured: true,
  },
  {
    name: "Plan Marca Propia",
    slug: "plan-marca-propia",
    displayName: "Plan Marca Propia (Dominio)",
    price: 30,
    currency: "USD",
    billingCycle: "monthly",
    domainType: "custom_domain",
    characteristics: [
      "Todas las funcionalidades de AgenditApp",
      "Tu dominio propio (ej. tusalon.com / .com.co)",
      "Recordatorios y confirmaciones automáticas por WhatsApp",
      "Configuración y soporte del dominio",
      "Soporte prioritario por WhatsApp"
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
    description: "Para negocios que quieren verse más profesionales y fortalecer su marca.",
    isActive: true,
  },
];

async function seedPlans() {
  try {
    await dbConnection();
    console.log("✓ Conectado a la base de datos");

    // Verificar si ya existen planes
    const existingPlans = await planModel.find();
    if (existingPlans.length > 0) {
      console.log(`\n⚠️  Ya existen ${existingPlans.length} planes en la base de datos.`);
      console.log("¿Deseas reemplazarlos? (ESTO ELIMINARÁ LOS PLANES EXISTENTES)");
      console.log("Para continuar, ejecuta: node seedPlans.js --force\n");
      
      if (!process.argv.includes("--force")) {
        console.log("Cancelando operación de seed...");
        process.exit(0);
      }

      // Eliminar planes existentes
      await planModel.deleteMany({});
      console.log("✓ Planes existentes eliminados");
    }

    // Crear nuevos planes
    console.log("\n📦 Creando planes...\n");
    for (const planData of defaultPlans) {
      const plan = await planModel.create(planData);
      console.log(`✓ Plan creado: ${plan.displayName} (${plan.slug})`);
      console.log(`  - Precio: $${plan.price.toLocaleString()} / ${plan.billingCycle}`);
      console.log(`  - Tipo de dominio: ${plan.domainType}`);
      console.log(`  - ID: ${plan._id}\n`);
    }

    console.log("✅ Seed de planes completado exitosamente!");
    console.log(`\n📊 Total de planes creados: ${defaultPlans.length}\n`);

    // Mostrar planes creados
    const plans = await planModel.find();
    console.log("Planes disponibles:");
    plans.forEach((plan) => {
      console.log(`  - ${plan.displayName}: ${plan._id}`);
    });

    process.exit(0);
  } catch (error) {
    console.error("❌ Error en seed de planes:", error);
    process.exit(1);
  }
}

seedPlans();
