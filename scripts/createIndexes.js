// scripts/createIndexes.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Client from '../src/models/clientModel.js';

dotenv.config({ path: '.env.development' });

async function createIndexes() {
  try {
    console.log('🚀 Iniciando creación de índices...\n');
    
    await mongoose.connect(process.env.DB_URI);
    console.log('✅ Conectado a MongoDB\n');
    
    // Obtener índices actuales
    const existingIndexes = await Client.collection.getIndexes();
    console.log('📋 Índices existentes:');
    Object.keys(existingIndexes).forEach(indexName => {
      console.log(`  - ${indexName}`);
    });
    
    console.log('\n🔨 Creando nuevos índices...');
    
    // Mongoose creará automáticamente los índices definidos en el schema
    await Client.syncIndexes();
    
    console.log('✅ Índices sincronizados correctamente\n');
    
    // Verificar los índices finales
    const finalIndexes = await Client.collection.getIndexes();
    console.log('📋 Índices finales:');
    Object.keys(finalIndexes).forEach(indexName => {
      const index = finalIndexes[indexName];
      console.log(`  - ${indexName}:`, JSON.stringify(index.key));
    });
    
    console.log('\n✨ Proceso completado exitosamente!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (error.code === 11000) {
      console.log('\n⚠️ DUPLICADOS DETECTADOS:');
      console.log('No se pudo crear el índice único porque hay registros duplicados.');
      console.log('Ejecuta el script de migración para identificar y resolver duplicados.');
    }
    
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Conexión a MongoDB cerrada');
  }
}

createIndexes();
