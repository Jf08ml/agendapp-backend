// cron/membershipCheckJob.js
import cron from "node-cron";
import membershipService from "../services/membershipService.js";
import appointmentService from "../services/appointmentService.js";
import Organization from "../models/organizationModel.js";

/**
 * Job que corre diariamente para verificar el estado de las membresías
 * - Envía notificaciones 3 días antes del vencimiento
 * - Envía notificación 1 día antes
 * - Envía notificación el día del vencimiento (inicia past_due → read-only)
 * - Envía recordatorios durante los 3 días de past_due
 * - Suspende acceso después de 3 días de past_due sin pago
 * - Auto-confirma citas del día y registra servicios a clientes
 */
const membershipCheckJob = cron.schedule(
  "0 9 * * *", // Todos los días a las 9:00 AM (hora Colombia)
  async () => {
    console.log("=== Iniciando verificación de membresías ===", new Date());

    try {
      // 1. Verificar membresías (idempotente por lastCheckedAt)
      const results = await membershipService.checkExpiringMemberships();

      // 2. Notificaciones de 3 días antes
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

      // 3. Notificaciones de 1 día antes
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

      // 4. Membresías que vencieron hoy → past_due (read-only)
      if (results.expired.length > 0) {
        console.log(`⚠️ ${results.expired.length} membresías vencieron hoy (past_due iniciado)`);
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

      // 5. Recordatorios durante período past_due
      if (results.pastDuePeriod.length > 0) {
        console.log(`🔔 Enviando ${results.pastDuePeriod.length} recordatorios de período past_due`);
        for (const { membership, day } of results.pastDuePeriod) {
          try {
            await membershipService.createMembershipNotification({
              organizationId: membership.organizationId._id,
              type: `past_due_${day}`,
              daysLeft: -day,
              membership,
            });
            console.log(`  ✓ Recordatorio día ${day}/3 enviado a ${membership.organizationId.name}`);
          } catch (err) {
            console.error(`  ✗ Error enviando recordatorio ${membership.organizationId._id}:`, err.message);
          }
        }
      }

      // 6. Suspender membresías que pasaron el período past_due
      if (results.toSuspend.length > 0) {
        console.log(`🚫 Suspendiendo ${results.toSuspend.length} membresías por falta de pago`);
        for (const membership of results.toSuspend) {
          try {
            await membershipService.suspendMembership(
              membership._id,
              "Período de past_due expirado sin pago"
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
      console.log(`Vencimientos hoy (→ past_due): ${results.expired.length}`);
      console.log(`Recordatorios past_due: ${results.pastDuePeriod.length}`);
      console.log(`Membresías suspendidas: ${results.toSuspend.length}`);
      console.log("=== Verificación completada ===\n");

      // 8. Auto-marcar asistencia en citas confirmed pasadas (por org con autoMarkAttended=true)
      console.log("\n=== Iniciando auto-mark attended ===");
      try {
        const activeOrgs = await Organization.find({
          membershipStatus: { $nin: ['suspended', 'cancelled'] },
          autoMarkAttended: true,
        }).select('_id name timezone');

        let totalMarked = 0;
        let orgsProcessed = 0;

        for (const org of activeOrgs) {
          try {
            const result = await appointmentService.autoMarkAttendedAppointments(org._id);
            if (result.updated > 0) {
              console.log(`  ✓ ${org.name}: ${result.updated} citas marcadas como attended`);
              totalMarked += result.updated;
            }
            orgsProcessed++;
          } catch (err) {
            console.error(`  ✗ Error procesando ${org.name}:`, err.message);
          }
        }

        console.log("\n=== Resumen de auto-mark attended ===");
        console.log(`Organizaciones procesadas: ${orgsProcessed}`);
        console.log(`Total citas marcadas attended: ${totalMarked}`);
        console.log("=== Auto-mark attended completado ===\n");
      } catch (error) {
        console.error("❌ Error en auto-mark attended:", error);
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

    let totalNotifications = 0;

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

    for (const { membership, day } of results.pastDuePeriod) {
      await membershipService.createMembershipNotification({
        organizationId: membership.organizationId._id,
        type: `past_due_${day}`,
        daysLeft: -day,
        membership,
      });
      totalNotifications++;
    }

    for (const membership of results.toSuspend) {
      await membershipService.suspendMembership(
        membership._id,
        "Período de past_due expirado sin pago"
      );
      await membershipService.createMembershipNotification({
        organizationId: membership.organizationId._id,
        type: "suspended",
        daysLeft: -3,
        membership,
      });
    }

    // Auto-marcar attended
    let totalAppointmentsMarked = 0;
    try {
      const activeOrgs = await Organization.find({
        membershipStatus: { $nin: ["suspended", "cancelled"] },
        autoMarkAttended: true,
      }).select("_id name");

      for (const org of activeOrgs) {
        const result = await appointmentService.autoMarkAttendedAppointments(org._id);
        totalAppointmentsMarked += result.updated;
      }
    } catch (error) {
      console.error("Error marcando citas attended:", error);
    }

    return {
      success: true,
      notifications: totalNotifications,
      suspended: results.toSuspend.length,
      appointmentsMarkedAttended: totalAppointmentsMarked,
      results,
    };
  } catch (error) {
    console.error("Error en verificación manual:", error);
    throw error;
  }
};

export default membershipCheckJob;
