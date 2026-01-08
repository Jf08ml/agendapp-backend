/**
 * Migración: Agregar campo maxConcurrentAppointments a servicios existentes
 * 👥 Permite que un empleado atienda múltiples clientes simultáneamente
 */

import mongoose from 'mongoose';
import 'dotenv/config.js';
import serviceModel from '../src/models/serviceModel.js';

async function migrateMaxConcurrentAppointments() {
  try {
    // Conectar a la base de datos
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/agenda-db');
    console.log('✅ Conectado a MongoDB');

    // Actualizar todos los servicios que no tengan maxConcurrentAppointments
    const result = await serviceModel.updateMany(
      { maxConcurrentAppointments: { $exists: false } },
      { $set: { maxConcurrentAppointments: 1 } }
    );

    console.log(`✅ Migración completada:`);
    console.log(`   - Documentos modificados: ${result.modifiedCount}`);
    console.log(`   - Documentos no modificados: ${result.matchedCount - result.modifiedCount}`);

    // Verificar algunos servicios para confirmar
    const services = await serviceModel.find().limit(5);
    console.log(`\n📋 Muestra de servicios actualizados:`);
    services.forEach(s => {
      console.log(`   - ${s.name}: maxConcurrentAppointments = ${s.maxConcurrentAppointments}`);
    });

  } catch (error) {
    console.error('❌ Error en migración:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Desconectado de MongoDB');
  }
}

// Ejecutar migración
migrateMaxConcurrentAppointments();
