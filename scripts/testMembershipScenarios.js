// scripts/testMembershipScenarios.js
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV}` });

import dbConnection from "../src/config/db.js";
import membershipModel from "../src/models/membershipModel.js";
import organizationModel from "../src/models/organizationModel.js";
import notificationModel from "../src/models/notificationModel.js";
import planModel from "../src/models/planModel.js";

/**
 * Script simple para probar escenarios de membresía
 */

async function runTest() {
  try {
    await dbConnection();
    console.log("✓ Conectado a la base de datos\n");

    const membershipId = "693900f455852661d966ae3e";
    const scenario = process.argv[2];

    const scenarios = {
      "1": { days: 3, desc: "3 días antes", expectedFlag: "threeDaysSent" },
      "2": { days: 1, desc: "1 día antes", expectedFlag: "oneDaySent" },
      "3": { days: 0, desc: "Día de vencimiento", expectedFlag: "expirationSent", changeStatus: "grace_period" },
      "4": { days: -2, desc: "Período de gracia día 1", expectedFlag: "gracePeriodDay1Sent", changeStatus: "grace_period" },
      "5": { days: -3, desc: "Período de gracia día 2", expectedFlag: "gracePeriodDay2Sent", changeStatus: "grace_period" },
      "6": { days: -4, desc: "Suspensión (3 días después)", changeStatus: "suspended" },
      "reset": { desc: "Restaurar a 30 días", days: 30 }
    };

    if (!scenario || !scenarios[scenario]) {
      console.log("🧪 Escenarios de Prueba Disponibles:\n");
      Object.keys(scenarios).forEach(key => {
        if (key !== 'reset') {
          console.log(`  ${key}. ${scenarios[key].desc}`);
        }
      });
      console.log(`  reset. Restaurar fecha original (30 días)\n`);
      console.log("Uso: node testMembershipScenarios.js <número>");
      console.log("Ejemplo: node testMembershipScenarios.js 1\n");
      process.exit(0);
    }

    const config = scenarios[scenario];
    const membership = await membershipModel.findById(membershipId).populate('organizationId planId');

    if (!membership) {
      console.error("❌ Membresía no encontrada");
      process.exit(1);
    }

    console.log("📋 Membresía:");
    console.log(`  Organización: ${membership.organizationId.name}`);
    console.log(`  Plan: ${membership.planId.displayName}`);
    console.log(`  Estado actual: ${membership.status}`);
    console.log(`  Vencimiento actual: ${membership.currentPeriodEnd.toLocaleString('es-CO')}`);
    console.log(`  Días hasta vencimiento: ${membership.daysUntilExpiration()}\n`);

    console.log(`🔧 Aplicando escenario: ${config.desc}\n`);

    // Calcular nueva fecha
    const newDate = new Date();
    newDate.setDate(newDate.getDate() + config.days);
    newDate.setHours(14, 0, 0, 0); // 9 AM Colombia (14:00 UTC)

    // Actualizar membresía
    membership.currentPeriodEnd = newDate;
    membership.nextPaymentDue = newDate;
    
    if (scenario === 'reset') {
      // Resetear todo
      membership.status = 'active';
      membership.suspendedAt = null;
      membership.suspensionReason = '';
      membership.notifications = {
        threeDaysSent: false,
        oneDaySent: false,
        expirationSent: false,
        gracePeriodDay1Sent: false,
        gracePeriodDay2Sent: false
      };
      
      await organizationModel.findByIdAndUpdate(membership.organizationId._id, {
        membershipStatus: 'active',
        hasAccessBlocked: false
      });
      
      console.log("✅ Membresía restaurada a 30 días");
    } else {
      // Resetear notificaciones para que se puedan enviar
      membership.notifications = {
        threeDaysSent: false,
        oneDaySent: false,
        expirationSent: false,
        gracePeriodDay1Sent: false,
        gracePeriodDay2Sent: false
      };

      if (config.changeStatus) {
        membership.status = config.changeStatus;
        
        await organizationModel.findByIdAndUpdate(membership.organizationId._id, {
          membershipStatus: config.changeStatus,
          hasAccessBlocked: config.changeStatus === 'suspended'
        });
      }

      if (config.changeStatus === 'suspended') {
        membership.suspendedAt = new Date();
        membership.suspensionReason = "Prueba de suspensión automática";
      }
    }

    await membership.save();

    console.log("✅ Cambios aplicados:");
    console.log(`  Nueva fecha vencimiento: ${newDate.toLocaleString('es-CO')}`);
    console.log(`  Días hasta vencimiento: ${membership.daysUntilExpiration()}`);
    console.log(`  Estado: ${membership.status}`);

    if (config.changeStatus === 'suspended') {
      const org = await organizationModel.findById(membership.organizationId._id);
      console.log(`  Acceso bloqueado: ${org.hasAccessBlocked ? 'SÍ ✓' : 'NO'}`);
    }

    console.log("\n📝 Próximos pasos:");
    console.log("  1. Ejecuta el cron job: curl http://localhost:3000/api/cron/check-memberships");
    console.log("  2. Verifica las notificaciones en la BD:");
    console.log(`     db.notifications.find({organizationId: ObjectId("${membership.organizationId._id}")})`);
    console.log("  3. Verifica en el frontend el banner y las notificaciones");
    console.log(`\n  Para probar otro escenario: node testMembershipScenarios.js <número>`);
    console.log(`  Para restaurar: node testMembershipScenarios.js reset\n`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

runTest();
