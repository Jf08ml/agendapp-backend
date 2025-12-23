/**
 * Script para debuguear la generación de slots
 * Simula exactamente lo que hace el endpoint /schedule/available-slots
 */

import moment from 'moment-timezone';
import dbConnection from '../src/config/db.js';
import organizationModel from '../src/models/organizationModel.js';
import employeeModel from '../src/models/employeeModel.js';
import appointmentModel from '../src/models/appointmentModel.js';
import scheduleService from '../src/services/scheduleService.js';

async function debugSlots() {
  console.log('=== DEBUG SLOTS GENERATION ===\n');

  try {
    // Conectar a la base de datos
    await dbConnection();
    console.log('✅ Conectado a la base de datos\n');

    // Usar la organización Bastidas Barber Studio
    const organizationId = '67564a6c13b8cd5834bf0e98';
    const date = '2025-01-24'; // Viernes

    console.log(`📅 Fecha solicitada: ${date}`);
    console.log(`🏢 Organization ID: ${organizationId}\n`);

    // Obtener la organización
    const organization = await organizationModel.findById(organizationId);
    if (!organization) {
      console.log('❌ Organización no encontrada');
      process.exit(1);
    }

    console.log(`✅ Organización: ${organization.name}`);
    console.log(`🌍 Timezone: ${organization.timezone || 'America/Bogota (default)'}\n`);

    // Verificar el horario del día (5 = viernes)
    const dayOfWeek = moment.tz(date, organization.timezone || 'America/Bogota').day();
    console.log(`📆 Día de la semana: ${dayOfWeek} (0=domingo, 5=viernes)`);
    
    const daySchedule = organization.schedule.find(s => s.day === dayOfWeek);
    if (!daySchedule) {
      console.log('❌ No hay horario configurado para este día');
      process.exit(1);
    }

    console.log(`⏰ Horario del día:`);
    console.log(`   Start: ${daySchedule.start}`);
    console.log(`   End: ${daySchedule.end}`);
    console.log(`   Breaks: ${JSON.stringify(daySchedule.breaks || [])}\n`);

    // Obtener citas del día
    const timezone = organization.timezone || 'America/Bogota';
    const startOfDay = moment.tz(date, timezone).startOf('day').toDate();
    const endOfDay = moment.tz(date, timezone).endOf('day').toDate();

    console.log(`🔍 Buscando citas entre:`);
    console.log(`   Start: ${startOfDay.toISOString()} (${moment.tz(startOfDay, timezone).format('YYYY-MM-DD HH:mm:ss')} ${timezone})`);
    console.log(`   End: ${endOfDay.toISOString()} (${moment.tz(endOfDay, timezone).format('YYYY-MM-DD HH:mm:ss')} ${timezone})\n`);

    const appointments = await appointmentModel.find({
      organizationId,
      startDate: { $gte: startOfDay, $lte: endOfDay }
    });

    console.log(`📋 Citas encontradas: ${appointments.length}`);
    if (appointments.length > 0) {
      appointments.forEach(appt => {
        console.log(`   - ${moment.tz(appt.startDate, timezone).format('HH:mm')} - ${moment.tz(appt.endDate, timezone).format('HH:mm')}`);
      });
    }
    console.log('');

    // Generar slots
    const duration = 30;
    console.log(`⚙️ Generando slots (duración: ${duration} min)...\n`);

    const slots = scheduleService.generateAvailableSlots(
      date,
      organization,
      null, // sin empleado específico
      duration,
      appointments
    );

    console.log(`📊 Total slots generados: ${slots.length}\n`);

    // Mostrar los primeros 10 slots
    console.log('🎯 Primeros 10 slots:');
    slots.slice(0, 10).forEach(slot => {
      const datetimeInTz = moment.tz(slot.datetime, timezone);
      console.log(`   ${slot.time} - ${slot.available ? '✅ Disponible' : '❌ Ocupado'} (datetime: ${datetimeInTz.format('YYYY-MM-DD HH:mm:ss')} ${timezone})`);
    });

    if (slots.length === 0) {
      console.log('\n⚠️ No se generaron slots. Posibles razones:');
      console.log('   - El día está cerrado');
      console.log('   - El horario no permite slots de esta duración');
      console.log('   - Todas las citas están ocupadas');
    } else {
      const firstSlot = slots[0];
      const firstSlotTime = firstSlot.time;
      const expectedTime = daySchedule.start;
      
      console.log(`\n🔍 Verificación:`);
      console.log(`   Primer slot generado: ${firstSlotTime}`);
      console.log(`   Hora de apertura: ${expectedTime}`);
      console.log(`   ¿Coinciden? ${firstSlotTime === expectedTime ? '✅ SÍ' : '❌ NO'}`);

      if (firstSlotTime !== expectedTime) {
        console.log(`\n⚠️ PROBLEMA DETECTADO:`);
        console.log(`   El primer slot debería ser ${expectedTime} pero es ${firstSlotTime}`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    process.exit(0);
  }
}

debugSlots();
