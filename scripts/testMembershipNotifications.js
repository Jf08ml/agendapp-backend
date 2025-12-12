// scripts/testMembershipNotifications.js
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV}` });

import dbConnection from "../src/config/db.js";
import membershipModel from "../src/models/membershipModel.js";
import { runMembershipCheck } from "../src/cron/membershipCheckJob.js";

/**
 * Script para probar notificaciones de membresía
 * Modifica temporalmente la fecha de vencimiento para simular diferentes escenarios
 */

const SCENARIOS = {
  "3-days": {
    name: "3 días antes del vencimiento",
    days: 3,
    expectedNotification: "threeDaysSent",
    expectedStatus: "active"
  },
  "1-day": {
    name: "1 día antes del vencimiento",
    days: 1,
    expectedNotification: "oneDaySent",
    expectedStatus: "active"
  },
  "expired": {
    name: "Día de vencimiento",
    days: 0,
    expectedNotification: "expirationSent",
    expectedStatus: "active"
  },
  "grace-1": {
    name: "Período de gracia - Día 1",
    days: -1,
    expectedNotification: "gracePeriodDay1Sent",
    expectedStatus: "grace_period"
  },
  "grace-2": {
    name: "Período de gracia - Día 2",
    days: -2,
    expectedNotification: "gracePeriodDay2Sent",
    expectedStatus: "grace_period"
  },
  "suspended": {
    name: "3 días después del vencimiento (suspensión)",
    days: -3,
    expectedNotification: null,
    expectedStatus: "suspended"
  }
};

async function testNotifications() {
  try {
    await dbConnection();
    console.log("✓ Conectado a la base de datos\n");

    // Obtener el ID de la membresía del argumento
    const membershipId = process.argv[2];
    const scenario = process.argv[3] || "3-days";

    if (!membershipId) {
      console.error("❌ Debes proporcionar el ID de la membresía");
      console.log("\nUso:");
      console.log("  node testMembershipNotifications.js <MEMBERSHIP_ID> <SCENARIO>\n");
      console.log("Escenarios disponibles:");
      Object.keys(SCENARIOS).forEach(key => {
        console.log(`  - ${key}: ${SCENARIOS[key].name}`);
      });
      process.exit(1);
    }

    if (!SCENARIOS[scenario]) {
      console.error(`❌ Escenario "${scenario}" no válido`);
      console.log("\nEscenarios disponibles:");
      Object.keys(SCENARIOS).forEach(key => {
        console.log(`  - ${key}: ${SCENARIOS[key].name}`);
      });
      process.exit(1);
    }

    // Buscar la membresía
    const membership = await membershipModel.findById(membershipId).populate('organizationId planId');
    
    if (!membership) {
      console.error(`❌ Membresía con ID ${membershipId} no encontrada`);
      process.exit(1);
    }

    console.log("📋 Membresía encontrada:");
    console.log(`  Organización: ${membership.organizationId.name}`);
    console.log(`  Plan: ${membership.planId.displayName}`);
    console.log(`  Estado actual: ${membership.status}`);
    console.log(`  Vencimiento actual: ${membership.currentPeriodEnd.toLocaleDateString()}\n`);

    // Calcular nueva fecha
    const scenarioConfig = SCENARIOS[scenario];
    const newEndDate = new Date();
    newEndDate.setDate(newEndDate.getDate() + scenarioConfig.days);
    newEndDate.setHours(23, 59, 59, 999); // Fin del día

    console.log(`🧪 Aplicando escenario: ${scenarioConfig.name}`);
    console.log(`  Nueva fecha de vencimiento: ${newEndDate.toLocaleDateString()}`);
    console.log(`  Notificación esperada: ${scenarioConfig.expectedNotification || 'Ninguna (suspensión)'}`);
    console.log(`  Estado esperado: ${scenarioConfig.expectedStatus}\n`);

    // Guardar fecha original para restaurar después
    const originalEndDate = membership.currentPeriodEnd;

    // Actualizar la fecha
    membership.currentPeriodEnd = newEndDate;
    membership.nextPaymentDue = newEndDate;
    
    // Reset notificaciones para que se envíen de nuevo
    membership.notifications = {
      threeDaysSent: false,
      oneDaySent: false,
      expirationSent: false,
      gracePeriodDay1Sent: false,
      gracePeriodDay2Sent: false
    };
    
    await membership.save();
    console.log("✓ Fecha de vencimiento actualizada temporalmente\n");

    // Ejecutar el cron job
    console.log("🔄 Ejecutando cron job de verificación de membresías...\n");
    await runMembershipCheck();

    // Verificar el resultado
    const updatedMembership = await membershipModel.findById(membershipId);
    
    console.log("\n📊 Resultados:");
    console.log(`  Estado final: ${updatedMembership.status}`);
    console.log(`  Notificaciones enviadas:`);
    console.log(`    - 3 días: ${updatedMembership.notifications.threeDaysSent ? '✓' : '✗'}`);
    console.log(`    - 1 día: ${updatedMembership.notifications.oneDaySent ? '✓' : '✗'}`);
    console.log(`    - Vencimiento: ${updatedMembership.notifications.expirationSent ? '✓' : '✗'}`);
    console.log(`    - Gracia día 1: ${updatedMembership.notifications.gracePeriodDay1Sent ? '✓' : '✗'}`);
    console.log(`    - Gracia día 2: ${updatedMembership.notifications.gracePeriodDay2Sent ? '✓' : '✗'}`);

    if (updatedMembership.status === 'suspended') {
      console.log(`  Suspendida: ${updatedMembership.suspendedAt ? '✓' : '✗'}`);
      console.log(`  Razón: ${updatedMembership.suspensionReason || 'N/A'}`);
    }

    // Preguntar si restaurar
    console.log("\n⚠️  ¿Deseas restaurar la fecha original?");
    console.log("   Para restaurar, ejecuta: node testMembershipNotifications.js <ID> restore\n");

    if (scenario === 'restore') {
      // Restaurar fecha original (debes guardarla en adminNotes temporalmente)
      console.log("🔄 Restaurando fecha original...");
      updatedMembership.currentPeriodEnd = originalEndDate;
      updatedMembership.nextPaymentDue = originalEndDate;
      updatedMembership.status = 'active';
      updatedMembership.suspendedAt = null;
      updatedMembership.suspensionReason = '';
      await updatedMembership.save();
      console.log("✓ Fecha restaurada");
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

testNotifications();
