// scripts/seedPlans.js
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV}` });

import dbConnection from "../src/config/db.js";
import planModel from "../src/models/planModel.js";

const defaultPlans = [
  {
    name: "Plan Esencial",
    slug: "plan-esencial",
    displayName: "Plan Esencial (Subdominio)",
    price: 50000, // Precio en pesos (o tu moneda)
    billingCycle: "monthly",
    domainType: "subdomain",
    characteristics: [
      "Subdominio personalizado (tuempresa.agenditapp.com)",
      "Gestión completa de citas y reservas",
      "Calendario y agenda digital",
      "Gestión de clientes y empleados",
      "Integración con WhatsApp",
      "Recordatorios automáticos",
      "Notificaciones push",
      "Panel de administración",
      "Estadísticas básicas",
      "Soporte por correo",
    ],
    limits: {
      maxEmployees: null, // Ilimitado
      maxServices: null,
      maxAppointmentsPerMonth: null,
      maxStorageGB: 5,
      customBranding: false,
      whatsappIntegration: true,
      analyticsAdvanced: false,
      prioritySupport: false,
    },
    description: "Ideal para pequeños negocios que están comenzando. Incluye todas las funcionalidades esenciales para gestionar tu negocio.",
    isActive: true,
  },
  {
    name: "Plan Marca Propia",
    slug: "plan-marca-propia",
    displayName: "Plan Marca Propia (Dominio)",
    price: 100000, // Precio en pesos (o tu moneda)
    billingCycle: "monthly",
    domainType: "custom_domain",
    characteristics: [
      "Dominio personalizado propio (tuempresa.com)",
      "Todas las características del Plan Esencial",
      "Branding personalizado (logo, colores, favicon)",
      "PWA con tu marca (icono, nombre, colores)",
      "Gestión completa de citas y reservas",
      "Calendario y agenda digital",
      "Gestión de clientes y empleados",
      "Integración con WhatsApp",
      "Recordatorios automáticos personalizados",
      "Notificaciones push con tu marca",
      "Panel de administración avanzado",
      "Estadísticas y reportes avanzados",
      "Soporte prioritario",
      "SSL incluido",
    ],
    limits: {
      maxEmployees: null, // Ilimitado
      maxServices: null,
      maxAppointmentsPerMonth: null,
      maxStorageGB: 20,
      customBranding: true,
      whatsappIntegration: true,
      analyticsAdvanced: true,
      prioritySupport: true,
    },
    description: "Perfecto para negocios establecidos que quieren proyectar su propia marca. Dominio personalizado y branding completo.",
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
