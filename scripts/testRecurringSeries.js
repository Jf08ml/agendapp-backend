/**
 * 🧪 Script de prueba para citas recurrentes
 * 
 * USO:
 * node scripts/testRecurringSeries.js
 * 
 * Este script prueba:
 * 1. Generación de ocurrencias semanales
 * 2. Validación de horarios de trabajo
 * 3. Detección de conflictos
 * 4. Preview de serie
 * 5. Creación de serie completa
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import appointmentSeriesService from '../src/services/appointmentSeriesService.js';
import organizationService from '../src/services/organizationService.js';
import employeeService from '../src/services/employeeService.js';
import serviceService from '../src/services/serviceService.js';
import clientService from '../src/services/clientService.js';

// Cargar variables de entorno
const envFile = process.env.NODE_ENV === 'production' 
  ? '.env.production' 
  : '.env.development';

dotenv.config({ path: envFile });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI no está definida en', envFile);
  process.exit(1);
}

console.log('🔗 Conectando a MongoDB...');

await mongoose.connect(MONGODB_URI);
console.log('✅ Conectado a MongoDB');

// ========================================
// Test 1: Generación de ocurrencias
// ========================================
async function testGenerateOccurrences() {
  console.log('\n📅 TEST 1: Generación de ocurrencias semanales');
  console.log('='.repeat(60));

  const baseDate = moment.tz('2026-01-06 10:00:00', 'America/Bogota').toDate(); // Lunes 6 de enero 2026
  
  const pattern = {
    type: 'weekly',
    intervalWeeks: 1,
    weekdays: [1, 3, 5], // Lun, Mie, Vie
    endType: 'count',
    count: 6
  };

  console.log('Fecha base:', baseDate);
  console.log('Patrón:', JSON.stringify(pattern, null, 2));

  const occurrences = appointmentSeriesService.generateWeeklyOccurrences(
    baseDate,
    pattern,
    'America/Bogota'
  );

  console.log(`\n✅ Generadas ${occurrences.length} ocurrencias:`);
  occurrences.forEach((occ, i) => {
    console.log(`  ${i + 1}. ${moment.tz(occ.date, 'America/Bogota').format('dddd DD/MM/YYYY HH:mm')}`);
  });
}

// ========================================
// Test 2: Preview de serie
// ========================================
async function testPreviewSeries() {
  console.log('\n🔍 TEST 2: Preview de serie');
  console.log('='.repeat(60));

  // Buscar datos reales de la base de datos
  const orgs = await organizationService.getAllOrganizations();
  if (!orgs || orgs.length === 0) {
    console.log('⚠️  No hay organizaciones. Saltando test.');
    return;
  }

  const org = orgs[0];
  console.log(`Usando organización: ${org.name}`);

  // Buscar empleado
  const employees = await employeeService.getEmployeesByOrganizationId(org._id.toString());
  if (!employees || employees.length === 0) {
    console.log('⚠️  No hay empleados. Saltando test.');
    return;
  }

  const employee = employees[0];
  console.log(`Usando empleado: ${employee.names}`);

  // Buscar servicio
  const services = await serviceService.getServicesByOrganizationId(org._id.toString());
  if (!services || services.length === 0) {
    console.log('⚠️  No hay servicios. Saltando test.');
    return;
  }

  const service = services[0];
  console.log(`Usando servicio: ${service.name} (${service.duration} min)`);

  // Buscar cliente
  const clients = await clientService.getClientsByOrganizationId(org._id.toString());
  if (!clients || clients.length === 0) {
    console.log('⚠️  No hay clientes. Saltando test.');
    return;
  }

  const client = clients[0];
  console.log(`Usando cliente: ${client.name}`);

  // Construir baseAppointment
  const baseDate = moment.tz('America/Bogota').add(1, 'day').hours(10).minutes(0).seconds(0);
  
  const baseAppointment = {
    service: service._id.toString(),
    employee: employee._id.toString(),
    client: client._id.toString(),
    startDate: baseDate.toDate(),
    endDate: baseDate.clone().add(service.duration || 60, 'minutes').toDate(),
    organizationId: org._id.toString(),
    advancePayment: 0,
    additionalItems: []
  };

  const recurrencePattern = {
    type: 'weekly',
    intervalWeeks: 1,
    weekdays: [1, 2, 3, 4, 5], // Lun-Vie
    endType: 'count',
    count: 4
  };

  console.log('\nGenerando preview...');
  
  const { occurrences, summary } = await appointmentSeriesService.previewSeriesAppointments(
    baseAppointment,
    recurrencePattern
  );

  console.log('\n📊 Resumen:');
  console.log(`  Total: ${summary.total}`);
  console.log(`  Disponibles: ${summary.available}`);
  console.log(`  No disponibles: ${summary.no_work}`);
  console.log(`  Conflictos: ${summary.conflict}`);
  console.log(`  Errores: ${summary.error}`);
  console.log(`  Se crearán: ${summary.willBeCreated}`);

  console.log('\n📋 Detalle de ocurrencias:');
  occurrences.forEach((occ, i) => {
    const icon = occ.status === 'available' ? '✅' : 
                 occ.status === 'no_work' ? '⚠️ ' :
                 occ.status === 'conflict' ? '❌' : '⛔';
    
    console.log(`  ${icon} ${occ.formattedDate} ${occ.formattedTime} - ${occ.status}`);
    if (occ.reason) {
      console.log(`     └─ ${occ.reason}`);
    }
  });
}

// ========================================
// Test 3: Crear serie (DRY RUN)
// ========================================
async function testCreateSeries() {
  console.log('\n💾 TEST 3: Crear serie (DRY RUN)');
  console.log('='.repeat(60));

  // Buscar datos reales
  const orgs = await organizationService.getAllOrganizations();
  if (!orgs || orgs.length === 0) {
    console.log('⚠️  No hay organizaciones. Saltando test.');
    return;
  }

  const org = orgs[0];
  const employees = await employeeService.getEmployeesByOrganizationId(org._id.toString());
  const services = await serviceService.getServicesByOrganizationId(org._id.toString());
  const clients = await clientService.getClientsByOrganizationId(org._id.toString());

  if (!employees?.length || !services?.length || !clients?.length) {
    console.log('⚠️  Faltan datos necesarios. Saltando test.');
    return;
  }

  const employee = employees[0];
  const service = services[0];
  const client = clients[0];

  // Fecha en el futuro para evitar conflictos
  const baseDate = moment.tz('America/Bogota').add(30, 'days').hours(14).minutes(0).seconds(0);
  
  const baseAppointment = {
    service: service._id.toString(),
    employee: employee._id.toString(),
    client: client._id.toString(),
    startDate: baseDate.toDate(),
    endDate: baseDate.clone().add(service.duration || 60, 'minutes').toDate(),
    organizationId: org._id.toString(),
    advancePayment: 0,
    additionalItems: []
  };

  const recurrencePattern = {
    type: 'weekly',
    intervalWeeks: 1,
    weekdays: [1, 3], // Lun, Mie
    endType: 'count',
    count: 3
  };

  console.log('⚠️  Este test NO creará citas realmente (comentado)');
  console.log('Configuración:');
  console.log(`  Fecha base: ${baseDate.format('DD/MM/YYYY HH:mm')}`);
  console.log(`  Patrón: Lunes y Miércoles, 3 veces`);
  console.log(`  Cliente: ${client.name}`);
  console.log(`  Empleado: ${employee.names}`);
  console.log(`  Servicio: ${service.name}`);

  // DESCOMENTA ESTO PARA CREAR REALMENTE LAS CITAS:
  /*
  console.log('\nCreando serie...');
  
  const result = await appointmentSeriesService.createSeriesAppointments(
    baseAppointment,
    recurrencePattern,
    { skipNotification: true }
  );

  console.log('\n✅ Serie creada:');
  console.log(`  SeriesId: ${result.seriesId}`);
  console.log(`  Creadas: ${result.created.length}`);
  console.log(`  Omitidas: ${result.skipped.length}`);

  console.log('\nCitas creadas:');
  result.created.forEach(apt => {
    console.log(`  - ${apt._id} - ${moment(apt.startDate).format('DD/MM/YYYY HH:mm')}`);
  });

  if (result.skipped.length > 0) {
    console.log('\nCitas omitidas:');
    result.skipped.forEach(skipped => {
      console.log(`  - ${moment(skipped.date).format('DD/MM/YYYY HH:mm')} - ${skipped.reason}`);
    });
  }
  */
}

// ========================================
// Ejecutar todos los tests
// ========================================
async function runAllTests() {
  try {
    await testGenerateOccurrences();
    await testPreviewSeries();
    await testCreateSeries();

    console.log('\n✅ Todos los tests completados');
  } catch (error) {
    console.error('\n❌ Error ejecutando tests:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Desconectado de MongoDB');
    process.exit(0);
  }
}

runAllTests();
