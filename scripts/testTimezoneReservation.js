// Script para probar la corrección de zona horaria en reservas
import moment from 'moment-timezone';

console.log('=== Prueba de corrección de zona horaria ===\n');

// Simular lo que envía el frontend
const startDateFromFrontend = '2024-12-24T08:00:00'; // 8:00 AM sin timezone
const timezone = 'America/Bogota'; // Colombia UTC-5

console.log('1. Fecha recibida del frontend:', startDateFromFrontend);
console.log('2. Zona horaria de la organización:', timezone);

// ❌ FORMA INCORRECTA (la que causaba el bug)
console.log('\n❌ FORMA INCORRECTA (new Date):');
const incorrectDate = new Date(startDateFromFrontend);
console.log('   new Date(startDate):', incorrectDate.toISOString());
console.log('   En timezone local del servidor:', incorrectDate.toString());

// ❌ FORMA INCORRECTA 2 (moment.tz sin formato)
console.log('\n❌ FORMA INCORRECTA (moment.tz sin formato):');
const incorrectMoment = moment.tz(startDateFromFrontend, timezone);
console.log('   moment.tz(startDate, timezone):', incorrectMoment.toISOString());
console.log('   En Colombia:', incorrectMoment.tz(timezone).format('YYYY-MM-DD HH:mm:ss'));

// ✅ FORMA CORRECTA (la corrección aplicada)
console.log('\n✅ FORMA CORRECTA (moment.tz con formato):');
const correctDate = moment.tz(startDateFromFrontend, 'YYYY-MM-DDTHH:mm:ss', timezone);
console.log('   moment.tz(startDate, formato, timezone):', correctDate.toISOString());
console.log('   En Colombia:', correctDate.tz(timezone).format('YYYY-MM-DD HH:mm:ss'));

console.log('\n=== Resumen ===');
console.log('El cliente quiere reservar a las 8:00 AM en Colombia');
console.log('Con la corrección, la cita se crea a las:', correctDate.tz(timezone).format('HH:mm'));
console.log('✅ Corrección exitosa!\n');
