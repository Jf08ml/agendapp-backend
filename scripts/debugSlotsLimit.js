/**
 * Debug para investigar por qué solo muestra slots hasta 1:00 PM
 */

import moment from 'moment-timezone';
import dbConnection from '../src/config/db.js';
import organizationModel from '../src/models/organizationModel.js';
import employeeModel from '../src/models/employeeModel.js';
import appointmentModel from '../src/models/appointmentModel.js';
import scheduleService from '../src/services/scheduleService.js';

async function debugSlotsLimit() {
  console.log('=== DEBUG: ¿Por qué solo slots hasta 1:00 PM? ===\n');

  try {
    await dbConnection();

    // Buscar una organización activa
    const organizations = await organizationModel.find({ isActive: true }).limit(5);
    
    if (!organizations.length) {
      console.log('❌ No hay organizaciones activas');
      process.exit(1);
    }

    console.log(`📋 Organizaciones encontradas: ${organizations.length}`);
    organizations.forEach((org, i) => {
      console.log(`  ${i+1}. ${org.name} (${org._id})`);
    });

    // Usar la primera organización
    const organization = organizations[0];
    const organizationId = organization._id.toString();
    
    // Buscar un día que esté abierto
    let date = '2024-12-24'; // Martes (día 2)
    let dayOfWeek = 2;
    let daySchedule = organization.schedule?.find(s => s.day === dayOfWeek);
    
    // Si no está abierto el martes, buscar el primer día abierto
    if (!daySchedule && organization.schedule?.length > 0) {
      daySchedule = organization.schedule[0];
      dayOfWeek = daySchedule.day;
      // Ajustar la fecha al día correcto
      const baseMoment = moment.tz('2024-12-22', organization.timezone || 'America/Bogota'); // Domingo
      date = baseMoment.add(dayOfWeek, 'days').format('YYYY-MM-DD');
    }

    console.log(`\n🏢 Usando: ${organization.name}`);
    console.log(`📅 Fecha: ${date}`);
    console.log(`🌍 Timezone: ${organization.timezone || 'America/Bogota (default)'}\n`);

    const timezone = organization.timezone || 'America/Bogota';
    
    console.log(`📆 Día de la semana: ${dayOfWeek} (0=domingo)`);
    
    if (!daySchedule) {
      console.log('❌ No hay horario configurado para ningún día');
      process.exit(1);
    }

    console.log(`\n⏰ Horario configurado:`);
    console.log(`   Start: ${daySchedule.start}`);
    console.log(`   End: ${daySchedule.end}`);
    console.log(`   Breaks: ${JSON.stringify(daySchedule.breaks || [])}`);
    
    // Convertir a minutos
    const timeToMinutes = (time) => {
      const [h, m] = time.split(':').map(Number);
      return h * 60 + m;
    };

    const startMin = timeToMinutes(daySchedule.start);
    const endMin = timeToMinutes(daySchedule.end);
    
    console.log(`\n🔢 En minutos:`);
    console.log(`   Start: ${startMin} min (${Math.floor(startMin/60)}:${String(startMin%60).padStart(2,'0')})`);
    console.log(`   End: ${endMin} min (${Math.floor(endMin/60)}:${String(endMin%60).padStart(2,'0')})`);
    console.log(`   Rango total: ${endMin - startMin} minutos = ${(endMin - startMin)/60} horas`);

    // Simular generación de slots
    const stepMinutes = organization.weeklySchedule?.stepMinutes || 
                        organization.openingHours?.stepMinutes || 30;
    const serviceDuration = 60; // 1 hora
    
    console.log(`\n⚙️ Configuración de slots:`);
    console.log(`   Step: ${stepMinutes} min`);
    console.log(`   Duración servicio: ${serviceDuration} min`);
    console.log(`   Último slot posible: ${endMin - serviceDuration} min (${Math.floor((endMin-serviceDuration)/60)}:${String((endMin-serviceDuration)%60).padStart(2,'0')})`);

    // Obtener citas del día
    const startOfDay = moment.tz(date, timezone).startOf('day').toDate();
    const endOfDay = moment.tz(date, timezone).endOf('day').toDate();

    const appointments = await appointmentModel.find({
      organizationId,
      startDate: { $gte: startOfDay, $lte: endOfDay }
    });

    console.log(`\n📋 Citas del día: ${appointments.length}`);
    if (appointments.length > 0) {
      appointments.forEach(appt => {
        const start = moment.tz(appt.startDate, timezone);
        const end = moment.tz(appt.endDate, timezone);
        console.log(`   - ${start.format('HH:mm')} - ${end.format('HH:mm')} (${appt.service?.name || 'Sin servicio'})`);
      });
    }

    // Generar slots usando el servicio real
    console.log(`\n🎯 Generando slots con generateAvailableSlots()...\n`);
    
    const slots = scheduleService.generateAvailableSlots(
      date,
      organization,
      null, // sin empleado específico
      serviceDuration,
      appointments
    );

    console.log(`📊 Total slots generados: ${slots.length}\n`);

    // Mostrar todos los slots
    if (slots.length === 0) {
      console.log('⚠️ No se generaron slots\n');
    } else {
      console.log('Lista completa de slots:');
      slots.forEach((slot, idx) => {
        const status = slot.available ? '✅ Disponible' : '❌ Ocupado';
        console.log(`   ${idx+1}. ${slot.time} - ${status}`);
      });

      const availableSlots = slots.filter(s => s.available);
      console.log(`\n📈 Resumen:`);
      console.log(`   Total slots: ${slots.length}`);
      console.log(`   Disponibles: ${availableSlots.length}`);
      console.log(`   Ocupados: ${slots.length - availableSlots.length}`);
      
      if (availableSlots.length > 0) {
        console.log(`   Primer slot disponible: ${availableSlots[0].time}`);
        console.log(`   Último slot disponible: ${availableSlots[availableSlots.length-1].time}`);
      }

      // Verificar si el último slot es el esperado
      const lastExpectedTime = Math.floor((endMin - serviceDuration) / 60) + ':' + 
                               String((endMin - serviceDuration) % 60).padStart(2, '0');
      const lastSlotTime = slots[slots.length - 1].time;
      
      console.log(`\n🔍 Verificación:`);
      console.log(`   Último slot esperado: ${lastExpectedTime}`);
      console.log(`   Último slot generado: ${lastSlotTime}`);
      console.log(`   ¿Coinciden? ${lastSlotTime === lastExpectedTime ? '✅ SÍ' : '❌ NO'}`);

      if (lastSlotTime !== lastExpectedTime) {
        console.log(`\n⚠️ PROBLEMA: El último slot debería ser ${lastExpectedTime} pero es ${lastSlotTime}`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    process.exit(0);
  }
}

debugSlotsLimit();
