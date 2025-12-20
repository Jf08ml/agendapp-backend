// scripts/migratePhoneNumbers.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Client from '../src/models/clientModel.js';
import Organization from '../src/models/organizationModel.js';
import { normalizePhoneNumber } from '../src/utils/phoneUtils.js';

// Cargar variables de entorno
dotenv.config({ path: '.env.development' });

async function connectDB() {
  try {
    await mongoose.connect(process.env.DB_URI);
    console.log('✅ Conectado a MongoDB');
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error);
    process.exit(1);
  }
}

async function migrateClientPhones() {
  console.log('\n🔄 Iniciando migración de teléfonos de clientes...');
  
  try {
    // 1. Obtener todas las organizaciones para mapear default_country
    const orgs = await Organization.find({}).select('_id default_country');
    const orgCountryMap = {};
    
    orgs.forEach(org => {
      orgCountryMap[org._id.toString()] = org.default_country || 'CO';
    });
    
    // 2. Obtener todos los clientes sin phone_e164
    const clients = await Client.find({
      $or: [
        { phone_e164: { $exists: false } },
        { phone_e164: null },
        { phone_e164: '' }
      ]
    });
    
    console.log(`📊 Encontrados ${clients.length} clientes para migrar`);
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // 3. Procesar cada cliente
    for (const client of clients) {
      try {
        const defaultCountry = orgCountryMap[client.organizationId.toString()] || 'CO';
        const result = normalizePhoneNumber(client.phoneNumber, defaultCountry);
        
        if (result.isValid) {
          // Verificar duplicados antes de actualizar
          const duplicate = await Client.findOne({
            _id: { $ne: client._id },
            phone_e164: result.phone_e164,
            organizationId: client.organizationId
          });
          
          if (duplicate) {
            console.warn(`⚠️ Duplicado encontrado: Cliente ${client._id} (${client.name}) - ${result.phone_e164}`);
            errors.push({
              clientId: client._id,
              name: client.name,
              phone: client.phoneNumber,
              error: 'Teléfono duplicado',
              phone_e164: result.phone_e164
            });
            errorCount++;
            continue;
          }
          
          await Client.updateOne(
            { _id: client._id },
            {
              $set: {
                phone_e164: result.phone_e164,
                phone_country: result.phone_country
              }
            }
          );
          
          successCount++;
          
          if (successCount % 100 === 0) {
            console.log(`✅ Procesados: ${successCount}/${clients.length}`);
          }
        } else {
          console.warn(`❌ Cliente ${client._id} (${client.name}): ${result.error} - ${client.phoneNumber}`);
          errors.push({
            clientId: client._id,
            name: client.name,
            phone: client.phoneNumber,
            error: result.error
          });
          errorCount++;
        }
      } catch (error) {
        console.error(`💥 Error procesando cliente ${client._id}:`, error.message);
        errors.push({
          clientId: client._id,
          name: client.name,
          phone: client.phoneNumber,
          error: error.message
        });
        errorCount++;
      }
    }
    
    // 4. Resumen final
    console.log('\n📈 RESUMEN DE MIGRACIÓN:');
    console.log(`✅ Éxitos: ${successCount}`);
    console.log(`❌ Errores: ${errorCount}`);
    
    if (errors.length > 0) {
      console.log('\n🚨 ERRORES ENCONTRADOS:');
      errors.forEach(err => {
        console.log(`- ${err.name} (${err.clientId}): ${err.error} - ${err.phone}`);
      });
    }
    
    return { successCount, errorCount, errors };
    
  } catch (error) {
    console.error('💥 Error durante la migración:', error);
    throw error;
  }
}

async function setDefaultCountries() {
  console.log('\n🌍 Configurando países por defecto para organizaciones...');
  
  try {
    const result = await Organization.updateMany(
      { default_country: { $exists: false } },
      { $set: { default_country: 'CO' } }
    );
    
    console.log(`✅ ${result.modifiedCount} organizaciones actualizadas con default_country: CO`);
    return result.modifiedCount;
    
  } catch (error) {
    console.error('❌ Error configurando países por defecto:', error);
    throw error;
  }
}

async function main() {
  try {
    console.log('🚀 Iniciando migración de números telefónicos a formato internacional...');
    
    await connectDB();
    
    // 1. Configurar países por defecto
    await setDefaultCountries();
    
    // 2. Migrar teléfonos de clientes
    const migrationResult = await migrateClientPhones();
    
    console.log('\n✨ Migración completada exitosamente!');
    console.log(`Total procesados: ${migrationResult.successCount + migrationResult.errorCount}`);
    console.log(`Éxitos: ${migrationResult.successCount}`);
    console.log(`Errores: ${migrationResult.errorCount}`);
    
    if (migrationResult.errorCount > 0) {
      console.log('\n⚠️ IMPORTANTE: Revisar y corregir manualmente los errores listados arriba.');
      console.log('Los teléfonos con errores mantienen su formato original.');
    }
    
  } catch (error) {
    console.error('💥 Error fatal durante la migración:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Conexión a MongoDB cerrada');
  }
}

// Ejecutar si se llama directamente
main().catch(err => {
  console.error('Error ejecutando migración:', err);
  process.exit(1);
});

export { migrateClientPhones, setDefaultCountries };