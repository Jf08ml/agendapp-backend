/**
 * Script para probar el sistema de timezones
 * Verifica que las fechas se estén manejando correctamente
 */

import moment from 'moment-timezone';

// Simular diferentes escenarios
console.log('🧪 Pruebas de Timezone\n');

// 1. Fecha UTC vs Colombia
const dateString = '2025-12-24';
const utcDate = new Date(dateString);
const colombiaDate = moment.tz(dateString, 'America/Bogota');
const mexicoDate = moment.tz(dateString, 'America/Mexico_City');

console.log('📅 Fecha: 2025-12-24');
console.log('UTC Date.getDay():', utcDate.getDay(), '(puede ser incorrecto si el servidor está en UTC)');
console.log('Colombia moment.day():', colombiaDate.day(), '(correcto para Colombia)');
console.log('México moment.day():', mexicoDate.day(), '(correcto para México)');
console.log('');

// 2. Appointment en UTC convertido a timezone local
const appointmentUTC = new Date('2025-12-24T13:00:00Z'); // 1:00 PM UTC
console.log('📌 Cita guardada en BD (UTC): 2025-12-24T13:00:00Z');
console.log('UTC getHours():', appointmentUTC.getHours(), 'hrs');

const apptColombia = moment.tz(appointmentUTC, 'America/Bogota');
const apptMexico = moment.tz(appointmentUTC, 'America/Mexico_City');

console.log('Colombia (GMT-5):', apptColombia.format('HH:mm'), 'hrs');
console.log('México (GMT-6):', apptMexico.format('HH:mm'), 'hrs');
console.log('');

// 3. Crear datetime para un slot
const slotTime = '10:00';
const slotDateColombia = moment.tz(`${dateString} ${slotTime}`, 'America/Bogota').toDate();
const slotDateMexico = moment.tz(`${dateString} ${slotTime}`, 'America/Mexico_City').toDate();

console.log('🕐 Slot: 10:00 AM');
console.log('Colombia:', slotDateColombia.toISOString());
console.log('México:', slotDateMexico.toISOString());
console.log('');

// 4. Verificar que las conversiones son correctas
console.log('✅ Verificaciones:');
console.log('- Cita a las 1:00 PM UTC = 8:00 AM Colombia?', apptColombia.hours() === 8);
console.log('- Cita a las 1:00 PM UTC = 7:00 AM México?', apptMexico.hours() === 7);
console.log('- Slot 10:00 AM Colombia en UTC = 3:00 PM?', slotDateColombia.getUTCHours() === 15);
console.log('- Slot 10:00 AM México en UTC = 4:00 PM?', slotDateMexico.getUTCHours() === 16);
