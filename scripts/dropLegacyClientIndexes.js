// scripts/dropLegacyClientIndexes.js
// Elimina índices únicos de teléfono que ya no aplican con el sistema de
// identificador flexible. Conserva los índices compuestos no únicos nuevos.
import mongoose from 'mongoose';
import dotenv from 'dotenv';

const envPath = process.env.ENV_FILE || '.env.development';
dotenv.config({ path: envPath });

const INDEXES_TO_DROP = [
  'phone_e164_1',               // único global (sin organizationId) — incorrecto multi-tenant
  'unique_phone_per_organization', // único compuesto por org — bloquea familia con mismo tel.
];

async function run() {
  console.log(`📄 Usando archivo de entorno: ${envPath}`);
  await mongoose.connect(process.env.DB_URI);
  console.log('✅ Conectado a MongoDB\n');

  const collection = mongoose.connection.collection('clients');
  const existing = await collection.indexes();

  console.log('📋 Índices actuales en la colección clients:');
  existing.forEach(idx => console.log(`  - ${idx.name} ${idx.unique ? '(unique)' : ''}`));
  console.log('');

  for (const indexName of INDEXES_TO_DROP) {
    const found = existing.find(idx => idx.name === indexName);
    if (!found) {
      console.log(`⏭️  "${indexName}" no existe, se omite.`);
      continue;
    }
    try {
      await collection.dropIndex(indexName);
      console.log(`🗑️  Índice "${indexName}" eliminado.`);
    } catch (err) {
      console.error(`❌ Error eliminando "${indexName}":`, err.message);
    }
  }

  console.log('\n📋 Índices resultantes:');
  const remaining = await collection.indexes();
  remaining.forEach(idx => console.log(`  - ${idx.name} ${idx.unique ? '(unique)' : ''}`));

  await mongoose.disconnect();
  console.log('\n✅ Listo.');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
