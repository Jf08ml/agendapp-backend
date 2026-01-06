// Script para probar la auto-confirmación de citas del día
import '../src/config/db.js';
import appointmentService from '../src/services/appointmentService.js';
import Organization from '../src/models/organizationModel.js';
import Appointment from '../src/models/appointmentModel.js';
import moment from 'moment-timezone';

async function testAutoConfirm() {
  try {
    console.log('=== Iniciando prueba de auto-confirmación de citas ===\n');

    // Obtener todas las organizaciones activas
    const orgs = await Organization.find({
      membershipStatus: { $ne: 'suspended' }
    }).select('_id name timezone');

    console.log(`Organizaciones encontradas: ${orgs.length}\n`);

    for (const org of orgs) {
      const timezone = org.timezone || 'America/Bogota';
      const startOfDay = moment.tz(timezone).startOf('day').toDate();
      const endOfDay = moment.tz(timezone).endOf('day').toDate();

      // Verificar cuántas citas pending tiene hoy
      const pendingCount = await Appointment.countDocuments({
        organizationId: org._id,
        status: 'pending',
        startDate: {
          $gte: startOfDay,
          $lte: endOfDay
        }
      });

      if (pendingCount > 0) {
        console.log(`📋 ${org.name} (${timezone})`);
        console.log(`   Citas pending hoy: ${pendingCount}`);
        
        // Ejecutar auto-confirmación
        const result = await appointmentService.autoConfirmTodayAppointments(org._id);
        
        console.log(`   ✓ Confirmadas: ${result.confirmed.length}`);
        console.log(`   ✗ Fallidas: ${result.failed.length}`);
        
        if (result.confirmed.length > 0) {
          console.log('   Detalles:');
          result.confirmed.forEach(c => {
            console.log(`     - ${c.clientName || 'Sin nombre'} - ${moment(c.startDate).format('HH:mm')}`);
          });
        }
        console.log('');
      }
    }

    console.log('=== Prueba completada ===');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testAutoConfirm();
