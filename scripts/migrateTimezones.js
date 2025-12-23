/**
 * Script para migrar organizaciones existentes y agregarles el campo timezone
 * Establece 'America/Bogota' como timezone por defecto para organizaciones sin este campo
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import organizationModel from '../src/models/organizationModel.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/agenda';
const DEFAULT_TIMEZONE = 'America/Bogota';

async function migrateTimezones() {
  try {
    console.log('🔌 Conectando a MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB');

    // Buscar organizaciones sin timezone o con timezone null/undefined
    const organizationsWithoutTimezone = await organizationModel.find({
      $or: [
        { timezone: { $exists: false } },
        { timezone: null },
        { timezone: '' }
      ]
    });

    console.log(`\n📊 Organizaciones sin timezone: ${organizationsWithoutTimezone.length}`);

    if (organizationsWithoutTimezone.length === 0) {
      console.log('✅ Todas las organizaciones ya tienen timezone configurado');
      return;
    }

    console.log('\n🔄 Actualizando organizaciones...\n');

    let updatedCount = 0;
    let errorCount = 0;

    for (const org of organizationsWithoutTimezone) {
      try {
        org.timezone = DEFAULT_TIMEZONE;
        await org.save();
        console.log(`✅ [${org._id}] ${org.name} - timezone: ${DEFAULT_TIMEZONE}`);
        updatedCount++;
      } catch (error) {
        console.error(`❌ Error actualizando ${org.name}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n📈 Resumen de migración:');
    console.log(`   ✅ Actualizadas: ${updatedCount}`);
    console.log(`   ❌ Errores: ${errorCount}`);
    console.log(`   📊 Total procesadas: ${organizationsWithoutTimezone.length}`);

    // Verificar que todas tengan timezone ahora
    const remainingWithoutTimezone = await organizationModel.countDocuments({
      $or: [
        { timezone: { $exists: false } },
        { timezone: null },
        { timezone: '' }
      ]
    });

    if (remainingWithoutTimezone === 0) {
      console.log('\n✅ ¡Migración completada exitosamente!');
    } else {
      console.log(`\n⚠️  Aún quedan ${remainingWithoutTimezone} organizaciones sin timezone`);
    }

  } catch (error) {
    console.error('❌ Error en la migración:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Desconectado de MongoDB');
    process.exit(0);
  }
}

// Ejecutar migración
console.log('🚀 Iniciando migración de timezones...\n');
migrateTimezones();
