// Script para migrar teléfonos de clientes al nuevo schema
// Ejecutar con: node scripts/migrateClientPhones.js

import mongoose from 'mongoose';
import Client from '../src/models/clientModel.js';
import Organization from '../src/models/organizationModel.js';
import { normalizePhoneNumber } from '../src/utils/phoneUtils.js';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/appointment-system';

async function migrateClientPhones() {
  try {
    console.log('🔌 Conectando a MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Conectado a MongoDB\n');

    // Buscar todos los clientes que NO tienen phone_e164
    const clientsToMigrate = await Client.find({
      $or: [
        { phone_e164: { $exists: false } },
        { phone_e164: null },
        { phone_e164: '' }
      ]
    });

    console.log(`📊 Clientes a migrar: ${clientsToMigrate.length}\n`);

    if (clientsToMigrate.length === 0) {
      console.log('✅ No hay clientes para migrar');
      await mongoose.disconnect();
      return;
    }

    let migrated = 0;
    let errors = 0;
    const errorDetails = [];

    for (const client of clientsToMigrate) {
      try {
        // Obtener país de la organización
        const org = await Organization.findById(client.organizationId).select('default_country');
        const defaultCountry = org?.default_country || 'CO';

        console.log(`\n🔄 Migrando cliente: ${client.name}`);
        console.log(`   ID: ${client._id}`);
        console.log(`   Teléfono actual: "${client.phoneNumber}"`);
        console.log(`   País organización: ${defaultCountry}`);

        // Normalizar el número
        const phoneResult = normalizePhoneNumber(client.phoneNumber, defaultCountry);

        if (!phoneResult.isValid) {
          throw new Error(phoneResult.error);
        }

        // Actualizar cliente
        client.phoneNumber = phoneResult.phone_national_clean; // Solo dígitos locales
        client.phone_e164 = phoneResult.phone_e164; // Con código de país
        client.phone_country = phoneResult.phone_country;

        await client.save();

        console.log(`   ✅ Migrado exitosamente:`);
        console.log(`      phoneNumber: ${client.phoneNumber}`);
        console.log(`      phone_e164: ${client.phone_e164}`);
        console.log(`      phone_country: ${client.phone_country}`);

        migrated++;

      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        errors++;
        errorDetails.push({
          clientId: client._id,
          name: client.name,
          phone: client.phoneNumber,
          error: error.message
        });
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📈 RESUMEN DE MIGRACIÓN');
    console.log('='.repeat(60));
    console.log(`Total procesados: ${clientsToMigrate.length}`);
    console.log(`✅ Migrados exitosamente: ${migrated}`);
    console.log(`❌ Errores: ${errors}`);

    if (errorDetails.length > 0) {
      console.log('\n❌ DETALLES DE ERRORES:');
      errorDetails.forEach((err, idx) => {
        console.log(`\n${idx + 1}. Cliente: ${err.name}`);
        console.log(`   ID: ${err.clientId}`);
        console.log(`   Teléfono: ${err.phone}`);
        console.log(`   Error: ${err.error}`);
      });
    }

    console.log('\n✅ Migración completada');
    await mongoose.disconnect();
    console.log('🔌 Desconectado de MongoDB');

  } catch (error) {
    console.error('💥 Error fatal:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Ejecutar migración
migrateClientPhones();
