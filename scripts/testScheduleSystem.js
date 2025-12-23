/**
 * Script de prueba para el sistema de horarios
 * Ejecutar con: node scripts/testScheduleSystem.js
 */

import mongoose from 'mongoose';
import organizationModel from '../src/models/organizationModel.js';
import employeeModel from '../src/models/employeeModel.js';
import scheduleService from '../src/services/scheduleService.js';

// Configuración de prueba
const TEST_ORG_ID = process.argv[2]; // Pasar el ID de organización como argumento
const TEST_EMPLOYEE_ID = process.argv[3]; // Opcional: ID de empleado

if (!TEST_ORG_ID) {
  console.log('❌ Uso: node scripts/testScheduleSystem.js <organizationId> [employeeId]');
  process.exit(1);
}

async function testScheduleSystem() {
  try {
    // Conectar a la base de datos
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado a la base de datos\n');

    // 1. Obtener organización
    const organization = await organizationModel.findById(TEST_ORG_ID);
    if (!organization) {
      console.log('❌ Organización no encontrada');
      process.exit(1);
    }
    console.log(`📍 Organización: ${organization.name}\n`);

    // 2. Mostrar horario de la organización
    console.log('🕒 HORARIO DE LA ORGANIZACIÓN:');
    console.log('━'.repeat(50));
    if (organization.weeklySchedule?.enabled) {
      console.log('✓ Horario semanal habilitado');
      console.log(`  Intervalo de slots: ${organization.weeklySchedule.stepMinutes} minutos\n`);
      
      organization.weeklySchedule.schedule.forEach(day => {
        const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const status = day.isOpen ? '✓ Abierto' : '✗ Cerrado';
        const hours = day.isOpen ? `${day.start} - ${day.end}` : '-';
        const breaks = day.breaks?.length > 0 
          ? ` | Breaks: ${day.breaks.map(b => `${b.start}-${b.end}`).join(', ')}`
          : '';
        
        console.log(`  ${dayNames[day.day].padEnd(10)} ${status.padEnd(10)} ${hours}${breaks}`);
      });
    } else {
      console.log('✗ Horario semanal no habilitado (usando horario general)');
      if (organization.openingHours) {
        console.log(`  Horario general: ${organization.openingHours.start} - ${organization.openingHours.end}`);
        console.log(`  Días laborales: ${organization.openingHours.businessDays?.join(', ') || 'No especificado'}`);
      }
    }
    console.log('');

    // 3. Si hay empleado, mostrar su horario
    if (TEST_EMPLOYEE_ID) {
      const employee = await employeeModel.findById(TEST_EMPLOYEE_ID);
      if (employee) {
        console.log('👤 HORARIO DEL EMPLEADO:');
        console.log('━'.repeat(50));
        console.log(`  Nombre: ${employee.names}\n`);
        
        if (employee.weeklySchedule?.enabled) {
          console.log('✓ Horario personalizado habilitado\n');
          
          employee.weeklySchedule.schedule.forEach(day => {
            const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
            const status = day.isAvailable ? '✓ Disponible' : '✗ No disponible';
            const hours = day.isAvailable ? `${day.start} - ${day.end}` : '-';
            const breaks = day.breaks?.length > 0 
              ? ` | Breaks: ${day.breaks.map(b => `${b.start}-${b.end}`).join(', ')}`
              : '';
            
            console.log(`  ${dayNames[day.day].padEnd(10)} ${status.padEnd(15)} ${hours}${breaks}`);
          });
        } else {
          console.log('✗ Horario personalizado no habilitado (sigue horario de organización)');
        }
        console.log('');
      }
    }

    // 4. Probar validación de fechas
    console.log('🔍 PRUEBAS DE VALIDACIÓN:');
    console.log('━'.repeat(50));

    const testDates = [
      new Date('2025-12-23T10:00:00'), // Lunes 10:00
      new Date('2025-12-23T15:30:00'), // Lunes 15:30
      new Date('2025-12-23T21:00:00'), // Lunes 21:00 (fuera de horario)
      new Date('2025-12-28T10:00:00'), // Sábado 10:00
      new Date('2025-12-29T10:00:00'), // Domingo 10:00
    ];

    const employee = TEST_EMPLOYEE_ID ? await employeeModel.findById(TEST_EMPLOYEE_ID) : null;

    for (const testDate of testDates) {
      const validation = scheduleService.validateDateTime(testDate, organization, employee);
      const dateStr = testDate.toLocaleString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      
      const status = validation.valid ? '✓' : '✗';
      const reason = validation.valid ? 'Válido' : validation.reason;
      
      console.log(`${status} ${dateStr}`);
      console.log(`  ${reason}\n`);
    }

    // 5. Generar slots para un día específico
    console.log('📅 SLOTS DISPONIBLES PARA MAÑANA:');
    console.log('━'.repeat(50));
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const slots = scheduleService.generateAvailableSlots(
      tomorrow,
      organization,
      employee,
      60 // 60 minutos de duración
    );

    if (slots.length === 0) {
      console.log('No hay slots disponibles (día cerrado)\n');
    } else {
      const dateStr = tomorrow.toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      console.log(`Fecha: ${dateStr}`);
      console.log(`Total de slots: ${slots.length}\n`);
      
      // Agrupar por momento del día
      const morning = slots.filter(s => parseInt(s.time.split(':')[0]) < 12);
      const afternoon = slots.filter(s => {
        const hour = parseInt(s.time.split(':')[0]);
        return hour >= 12 && hour < 18;
      });
      const evening = slots.filter(s => parseInt(s.time.split(':')[0]) >= 18);

      if (morning.length > 0) {
        console.log('☀️  Mañana:');
        console.log(`  ${morning.map(s => s.time).join(', ')}\n`);
      }

      if (afternoon.length > 0) {
        console.log('🌤️  Tarde:');
        console.log(`  ${afternoon.map(s => s.time).join(', ')}\n`);
      }

      if (evening.length > 0) {
        console.log('🌙 Noche:');
        console.log(`  ${evening.map(s => s.time).join(', ')}\n`);
      }
    }

    // 6. Obtener días abiertos
    console.log('📆 DÍAS ABIERTOS DE LA SEMANA:');
    console.log('━'.repeat(50));
    const openDays = scheduleService.getOpenDays(organization);
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    console.log(openDays.map(d => dayNames[d]).join(', '));
    console.log('');

    if (employee) {
      const employeeOpenDays = scheduleService.getEmployeeAvailableDays(employee, organization);
      console.log('👤 Días disponibles del empleado:');
      console.log(employeeOpenDays.map(d => dayNames[d]).join(', '));
      console.log('');
    }

    console.log('✅ Pruebas completadas exitosamente!');

  } catch (error) {
    console.error('❌ Error en las pruebas:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

// Ejecutar pruebas
testScheduleSystem();
