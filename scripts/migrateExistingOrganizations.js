// scripts/migrateExistingOrganizations.js
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV}` });

import dbConnection from "../src/config/db.js";
import organizationModel from "../src/models/organizationModel.js";
import planModel from "../src/models/planModel.js";
import membershipService from "../src/services/membershipService.js";

/**
 * Script de migración para organizaciones existentes
 * 
 * Este script:
 * 1. Busca todas las organizaciones sin membresía activa
 * 2. Les asigna un plan según su configuración actual
 * 3. Crea una membresía con período de gracia
 */

async function migrateOrganizations() {
  try {
    await dbConnection();
    console.log("✓ Conectado a la base de datos\n");

    // 1. Obtener todos los planes disponibles
    const plans = await planModel.find();
    console.log(`📋 Planes disponibles: ${plans.length}`);
    plans.forEach(plan => {
      console.log(`  - ${plan.displayName} (${plan.slug}): ${plan._id}`);
    });
    console.log("");

    if (plans.length === 0) {
      console.error("❌ No hay planes disponibles. Ejecuta primero: node scripts/seedPlans.js");
      process.exit(1);
    }

    // 2. Obtener organizaciones sin membresía activa
    const organizations = await organizationModel.find({
      currentMembershipId: null,
    });

    console.log(`🏢 Organizaciones encontradas sin membresía: ${organizations.length}\n`);

    if (organizations.length === 0) {
      console.log("✅ Todas las organizaciones ya tienen membresía asignada!");
      process.exit(0);
    }

    // 3. Preguntar confirmación
    console.log("⚠️  Este script creará membresías para todas las organizaciones sin membresía.");
    console.log("¿Deseas continuar? Ejecuta con --confirm para confirmar\n");

    if (!process.argv.includes("--confirm")) {
      console.log("Cancelando migración. Para ejecutar, usa: node migrateExistingOrganizations.js --confirm");
      process.exit(0);
    }

    // 4. Configurar opciones de migración
    const migrationOptions = {
      defaultPlanSlug: process.env.DEFAULT_PLAN_SLUG || "plan-esencial",
      gracePeriodDays: parseInt(process.env.MIGRATION_GRACE_DAYS) || 30, // 30 días de gracia
      trialDays: 0, // No es trial, ya son clientes existentes
    };

    console.log("📝 Opciones de migración:");
    console.log(`  - Plan por defecto: ${migrationOptions.defaultPlanSlug}`);
    console.log(`  - Días de gracia: ${migrationOptions.gracePeriodDays}`);
    console.log("");

    const defaultPlan = plans.find(p => p.slug === migrationOptions.defaultPlanSlug);
    
    if (!defaultPlan) {
      console.error(`❌ Plan "${migrationOptions.defaultPlanSlug}" no encontrado`);
      process.exit(1);
    }

    // 5. Migrar cada organización
    let successCount = 0;
    let errorCount = 0;

    for (const org of organizations) {
      try {
        console.log(`Procesando: ${org.name} (${org._id})`);

        // Determinar el plan según la configuración actual
        let selectedPlan = defaultPlan;

        // Si la organización tiene dominio personalizado, asignar plan premium
        const hasCustomDomain = org.domains.some(d => !d.includes("agenditapp.com"));
        if (hasCustomDomain) {
          const premiumPlan = plans.find(p => p.domainType === "custom_domain");
          if (premiumPlan) {
            selectedPlan = premiumPlan;
            console.log(`  → Detectado dominio personalizado, asignando: ${selectedPlan.displayName}`);
          }
        }

        // Calcular fecha de vencimiento (hoy + días de gracia)
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setDate(periodEnd.getDate() + migrationOptions.gracePeriodDays);

        // Crear membresía
        const membership = await membershipService.createMembership({
          organizationId: org._id,
          planId: selectedPlan._id,
          startDate: now,
          trialDays: migrationOptions.trialDays,
        });

        // Actualizar período para dar tiempo de gracia
        membership.currentPeriodEnd = periodEnd;
        membership.nextPaymentDue = periodEnd;
        membership.status = "active"; // Activar inmediatamente
        await membership.save();

        console.log(`  ✓ Membresía creada: ${selectedPlan.displayName}`);
        console.log(`  ✓ Período de gracia hasta: ${periodEnd.toLocaleDateString()}`);
        console.log("");

        successCount++;

      } catch (error) {
        console.error(`  ✗ Error procesando ${org.name}:`, error.message);
        console.log("");
        errorCount++;
      }
    }

    // 6. Resumen final
    console.log("\n=== Migración Completada ===");
    console.log(`✅ Organizaciones migradas exitosamente: ${successCount}`);
    if (errorCount > 0) {
      console.log(`❌ Organizaciones con errores: ${errorCount}`);
    }
    console.log("");

    // 7. Verificar resultados
    const orgsWithMembership = await organizationModel.countDocuments({
      currentMembershipId: { $ne: null },
    });
    console.log(`📊 Total de organizaciones con membresía: ${orgsWithMembership}`);

    process.exit(0);

  } catch (error) {
    console.error("❌ Error en migración:", error);
    process.exit(1);
  }
}

// Configuración de ayuda
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
Uso: node migrateExistingOrganizations.js [opciones]

Opciones:
  --confirm              Confirmar ejecución de la migración
  --help, -h            Mostrar esta ayuda

Variables de entorno opcionales:
  DEFAULT_PLAN_SLUG      Slug del plan por defecto (default: "plan-esencial")
  MIGRATION_GRACE_DAYS   Días de gracia para pago (default: 30)

Ejemplos:
  # Ejecutar migración con 30 días de gracia
  node migrateExistingOrganizations.js --confirm

  # Ejecutar con plan personalizado
  DEFAULT_PLAN_SLUG=plan-marca-propia node migrateExistingOrganizations.js --confirm

  # Ejecutar con 60 días de gracia
  MIGRATION_GRACE_DAYS=60 node migrateExistingOrganizations.js --confirm
  `);
  process.exit(0);
}

migrateOrganizations();
