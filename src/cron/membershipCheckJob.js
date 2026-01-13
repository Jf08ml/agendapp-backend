// cron/membershipCheckJob.js
import cron from "node-cron";
import membershipService from "../services/membershipService.js";
import appointmentService from "../services/appointmentService.js";
import Organization from "../models/organizationModel.js";

/**
 * Job que corre diariamente para verificar el estado de las membresías
 * - Envía notificaciones 3 días antes del vencimiento
 * - Envía notificación 1 día antes
 * - Envía notificación el día del vencimiento (inicia período de gracia)
 * - Envía recordatorios durante los 2 días de gracia
 * - Suspende acceso después de 2 días de gracia sin pago
 * - Auto-confirma citas del día y registra servicios a clientes
 */
const membershipCheckJob = cron.schedule(
  "0 9 * * *", // Todos los días a las 9:00 AM (hora Colombia)
  async () => {
    console.log("=== Iniciando verificación de membresías ===", new Date());

    try {
      // 1. Verificar membresías que están por vencer y necesitan notificaciones
      const results = await membershipService.checkExpiringMemberships();

      // 2. Enviar notificaciones de 3 días antes
      if (results.threeDays.length > 0) {
        console.log(`📧 Enviando ${results.threeDays.length} notificaciones de 3 días antes`);
        for (const membership of results.threeDays) {
          try {
            const daysLeft = membership.daysUntilExpiration();
            await membershipService.createMembershipNotification({
              organizationId: membership.organizationId._id,
              type: "3_days_warning",
              daysLeft,
              membership,
            });
            console.log(`  ✓ Notificación enviada a ${membership.organizationId.name}`);
          } catch (err) {
            console.error(`  ✗ Error notificando organización ${membership.organizationId._id}:`, err.message);
          }
        }
      }

      // 3. Enviar notificaciones de 1 día antes
      if (results.oneDay.length > 0) {
        console.log(`📧 Enviando ${results.oneDay.length} notificaciones de 1 día antes`);
        for (const membership of results.oneDay) {
          try {
            const daysLeft = membership.daysUntilExpiration();
            await membershipService.createMembershipNotification({
              organizationId: membership.organizationId._id,
              type: "1_day_warning",
              daysLeft,
              membership,
            });
            console.log(`  ✓ Notificación enviada a ${membership.organizationId.name}`);
          } catch (err) {
            console.error(`  ✗ Error notificando organización ${membership.organizationId._id}:`, err.message);
          }
        }
      }

      // 4. Notificar membresías que vencieron hoy (inician período de gracia)
      if (results.expired.length > 0) {
        console.log(`⚠️ ${results.expired.length} membresías vencieron hoy (período de gracia iniciado)`);
        for (const membership of results.expired) {
          try {
            await membershipService.createMembershipNotification({
              organizationId: membership.organizationId._id,
              type: "expired",
              daysLeft: 0,
              membership,
            });
            console.log(`  ✓ Notificación de vencimiento enviada a ${membership.organizationId.name}`);
          } catch (err) {
            console.error(`  ✗ Error notificando vencimiento ${membership.organizationId._id}:`, err.message);
          }
        }
      }

      // 5. Enviar recordatorios durante período de gracia
      if (results.gracePeriod.length > 0) {
        console.log(`🔔 Enviando ${results.gracePeriod.length} recordatorios de período de gracia`);
        for (const { membership, day } of results.gracePeriod) {
          try {
            await membershipService.createMembershipNotification({
              organizationId: membership.organizationId._id,
              type: `grace_period_${day}`,
              daysLeft: -day,
              membership,
            });
            console.log(`  ✓ Recordatorio día ${day}/2 enviado a ${membership.organizationId.name}`);
          } catch (err) {
            console.error(`  ✗ Error enviando recordatorio ${membership.organizationId._id}:`, err.message);
          }
        }
      }

      // 6. Suspender membresías que pasaron el período de gracia
      if (results.toSuspend.length > 0) {
        console.log(`🚫 Suspendiendo ${results.toSuspend.length} membresías por falta de pago`);
        for (const membership of results.toSuspend) {
          try {
            await membershipService.suspendMembership(
              membership._id,
              "Período de gracia expirado sin pago"
            );
            
            await membershipService.createMembershipNotification({
              organizationId: membership.organizationId._id,
              type: "suspended",
              daysLeft: -3,
              membership,
            });
            
            console.log(`  ✓ Membresía suspendida: ${membership.organizationId.name}`);
          } catch (err) {
            console.error(`  ✗ Error suspendiendo membresía ${membership._id}:`, err.message);
          }
        }
      }

      // 7. Resumen
      console.log("\n=== Resumen de verificación de membresías ===");
      console.log(`Notificaciones 3 días: ${results.threeDays.length}`);
      console.log(`Notificaciones 1 día: ${results.oneDay.length}`);
      console.log(`Vencimientos hoy: ${results.expired.length}`);
      console.log(`Recordatorios período gracia: ${results.gracePeriod.length}`);
      console.log(`Membresías suspendidas: ${results.toSuspend.length}`);
      console.log("=== Verificación completada ===\n");
      // 8. Auto-confirmar citas del día para todas las organizaciones activas
      console.log("\n=== Iniciando auto-confirmación de citas del día ===");
      try {
        const activeOrgs = await Organization.find({
          membershipStatus: { $ne: 'suspended' }
        }).select('_id name timezone');

        let totalConfirmed = 0;
        let totalFailed = 0;
        let orgsProcessed = 0;

        for (const org of activeOrgs) {
          try {
            const result = await appointmentService.autoConfirmTodayAppointments(org._id);
            
            if (result.confirmed.length > 0) {
              console.log(`  ✓ ${org.name}: ${result.confirmed.length} citas confirmadas`);
              totalConfirmed += result.confirmed.length;
            }
            
            if (result.failed.length > 0) {
              console.log(`  ✗ ${org.name}: ${result.failed.length} citas fallidas`);
              totalFailed += result.failed.length;
            }
            
            orgsProcessed++;
          } catch (err) {
            console.error(`  ✗ Error procesando ${org.name}:`, err.message);
          }
        }

        console.log("\n=== Resumen de auto-confirmación ===");
        console.log(`Organizaciones procesadas: ${orgsProcessed}`);
        console.log(`Total citas confirmadas: ${totalConfirmed}`);
        console.log(`Total citas fallidas: ${totalFailed}`);
        console.log("=== Auto-confirmación completada ===\n");
      } catch (error) {
        console.error("❌ Error en auto-confirmación de citas:", error);
      }


    } catch (error) {
      console.error("❌ Error en verificación de membresías:", error);
    }
  },
  {
    scheduled: false,
    timezone: "America/Bogota",
  }
);

/**
 * Función para ejecutar el job manualmente (útil para testing)
 */
export const runMembershipCheck = async () => {
  console.log("🔧 Ejecutando verificación manual de membresías...");
  try {
    const results = await membershipService.checkExpiringMemberships();
    
    // Procesar resultados (mismo código que el cron)
    let totalNotifications = 0;
    let totalAppointmentsConfirmed = 0;

    // Notificaciones de membresía
    for (const membership of results.threeDays) {
      await membershipService.createMembershipNotification({
        organizationId: membership.organizationId._id,
        type: "3_days_warning",
        daysLeft: membership.daysUntilExpiration(),
        membership,
      });
      totalNotifications++;
    }

    for (const membership of results.oneDay) {
      await membershipService.createMembershipNotification({
        organizationId: membership.organizationId._id,
        type: "1_day_warning",
        daysLeft: membership.daysUntilExpiration(),
        membership,
      });
      totalNotifications++;
    }
    
    for (const membership of results.expired) {
      await membershipService.createMembershipNotification({
        organizationId: membership.organizationId._id,
        type: "expired",
        daysLeft: 0,
        membership,
      });
      totalNotifications++;
    }
    
    for (const { membership } of results.gracePeriod) {
      const day = Math.abs(membership.daysUntilExpiration()) - 1;
      await membershipService.createMembershipNotification({
        organizationId: membership.organizationId._id,
        type: `grace_period_${day}`,
        daysLeft: -day,
        membership,
      });
      totalNotifications++;
    }
    
    for (const membership of results.toSuspend) {
      await membershipService.suspendMembership(
        membership._id,
        "Período de gracia expirado sin pago"
      );
      await membershipService.createMembershipNotification({
        organizationId: membership.organizationId._id,
        type: "suspended",
        daysLeft: -3,
        membership,
      });
    }

    // Auto-confirmar citas del día para organizaciones con membresía no suspendida
    try {
      const activeOrgs = await Organization.find({
        membershipStatus: { $ne: "suspended" }
      }).select("_id name");

      for (const org of activeOrgs) {
        const result = await appointmentService.autoConfirmTodayAppointments(org._id);
        totalAppointmentsConfirmed += result.confirmed.length;
      }
    } catch (error) {
      console.error("Error confirmando citas:", error);
    }
    
    return {
      success: true,
      notifications: totalNotifications,
      suspended: results.toSuspend.length,
      appointmentsConfirmed: totalAppointmentsConfirmed,
      results,
    };
  } catch (error) {
    console.error("Error en verificación manual:", error);
    throw error;
  }
};

export default membershipCheckJob;
