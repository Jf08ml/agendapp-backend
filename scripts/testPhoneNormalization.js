// Script para probar la normalización de teléfonos
import { normalizePhoneNumber } from '../src/utils/phoneUtils.js';

const testNumbers = [
  { phone: '3001234567', country: 'CO', description: 'Móvil Colombia sin prefijo' },
  { phone: '3009876543', country: 'CO', description: 'Móvil Colombia sin prefijo' },
  { phone: '+57 300 123 4567', country: 'CO', description: 'Móvil Colombia con prefijo' },
  { phone: '3001234567', country: 'MX', description: 'Con país México' },
  { phone: '3001234567', country: 'PE', description: 'Con país Perú' },
  { phone: '3001234567', country: 'SV', description: 'Con país El Salvador' },
];

console.log('\n=== PRUEBAS DE NORMALIZACIÓN DE TELÉFONOS ===\n');

testNumbers.forEach((test, index) => {
  console.log(`\nPrueba ${index + 1}: ${test.description}`);
  console.log(`Input: "${test.phone}", País: ${test.country}`);
  const result = normalizePhoneNumber(test.phone, test.country);
  console.log('Resultado:', JSON.stringify(result, null, 2));
  console.log('---');
});

console.log('\n=== FIN DE PRUEBAS ===\n');
