import moment from 'moment-timezone';

console.log('=== TEST MOMENT-TIMEZONE STRING PARSING ===\n');

const dateString = '2025-01-24'; // Como viene del frontend
const timezone = 'America/Bogota';

// Así es como lo hace el código actual
const dateInTz = moment.tz(dateString, timezone);

console.log(`Input: "${dateString}"`);
console.log(`Timezone: ${timezone}\n`);

console.log(`moment.tz(dateString, timezone):`);
console.log(`  - Format YYYY-MM-DD: ${dateInTz.format('YYYY-MM-DD')}`);
console.log(`  - Format YYYY-MM-DD HH:mm:ss: ${dateInTz.format('YYYY-MM-DD HH:mm:ss')}`);
console.log(`  - Format YYYY-MM-DDTHH:mm:ssZ: ${dateInTz.format('YYYY-MM-DDTHH:mm:ssZ')}`);
console.log(`  - toISOString(): ${dateInTz.toDate().toISOString()}`);
console.log(`  - day(): ${dateInTz.day()}`);
console.log('');

// Crear un slot a las 08:00
const hours = 8;
const minutes = 0;
const slotDatetime = moment.tz(
  `${dateInTz.format('YYYY-MM-DD')} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
  timezone
);

console.log(`Slot at 08:00:`);
console.log(`  - String usado: "${dateInTz.format('YYYY-MM-DD')} 08:00"`);
console.log(`  - Format HH:mm: ${slotDatetime.format('HH:mm')}`);
console.log(`  - Format YYYY-MM-DD HH:mm: ${slotDatetime.format('YYYY-MM-DD HH:mm')}`);
console.log(`  - toISOString(): ${slotDatetime.toDate().toISOString()}`);
console.log('');

// Simular lo que hace el frontend cuando recibe esa fecha
const isoFromBackend = slotDatetime.toDate().toISOString(); // "2025-01-24T13:00:00.000Z" 
console.log(`Frontend recibe: ${isoFromBackend}`);
console.log(`  - dayjs(iso) en Colombia mostrará: ${moment.tz(isoFromBackend, timezone).format('HH:mm')}`);
console.log(`  - dayjs(iso) en UTC mostrará: ${moment.tz(isoFromBackend, 'UTC').format('HH:mm')}`);
console.log(`  - new Date(iso).getHours() mostrará: ${new Date(isoFromBackend).getHours()} (timezone local)`);
