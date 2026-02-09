function timeToMinutes(time) {
  if (!time) return 0;
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

const startMin = timeToMinutes('13:00');
const endMin = timeToMinutes('19:30');
const breakStart = timeToMinutes('15:00');
const breakEnd = timeToMinutes('15:30');
const stepMinutes = 60;
const totalDuration = 60;

console.log('Configuración:');
console.log('  Horario: 13:00 - 19:30');
console.log('  Descanso: 15:00 - 15:30');
console.log('  Intervalo: 60 min');
console.log('  Duración servicio: 60 min');
console.log('');

// Crear segmentos
const segments = [];
let currentSegmentStart = startMin;
const sortedBreaks = [{startMin: breakStart, endMin: breakEnd}];

for (const breakPeriod of sortedBreaks) {
  if (currentSegmentStart < breakPeriod.startMin) {
    segments.push({
      start: currentSegmentStart,
      end: breakPeriod.startMin
    });
  }
  currentSegmentStart = Math.max(currentSegmentStart, breakPeriod.endMin);
}

if (currentSegmentStart < endMin) {
  segments.push({
    start: currentSegmentStart,
    end: endMin
  });
}

console.log('Segmentos creados:');
segments.forEach((s, i) => {
  console.log(`  Segmento ${i+1}: ${minutesToTime(s.start)} - ${minutesToTime(s.end)} (${s.end - s.start} min)`);
});
console.log('');

// Generar bloques
const blocks = [];
for (const segment of segments) {
  console.log(`Procesando segmento: ${minutesToTime(segment.start)} - ${minutesToTime(segment.end)}`);
  for (let currentMin = segment.start; currentMin <= segment.end - totalDuration; currentMin += stepMinutes) {
    const blockStart = minutesToTime(currentMin);
    const blockEnd = minutesToTime(currentMin + totalDuration);
    console.log(`  ✓ Bloque: ${blockStart} - ${blockEnd}`);
    blocks.push({start: blockStart, end: blockEnd});
  }
  console.log('');
}

console.log('TOTAL DE BLOQUES GENERADOS:', blocks.length);
console.log('Bloques:', blocks);
