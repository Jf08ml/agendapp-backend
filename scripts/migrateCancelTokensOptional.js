import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/agendaDB';

/**
 * Script OPCIONAL para migrar tokens de cancelación de bcrypt a SHA-256
 * 
 * ⚠️  IMPORTANTE: Este script NO es necesario para el funcionamiento del sistema
 * El sistema ya tiene migración automática cuando se use un token antiguo.
 * 
 * Este script es útil si quieres:
 * - Acelerar la primera consulta de tokens antiguos
 * - Migrar todos los tokens de una vez en lugar de gradualmente
 * - Limpiar la base de datos antes de eliminar bcrypt del código
 */

async function migrateCancelTokens() {
  try {
    console.log('🔌 Conectando a MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB');

    const db = mongoose.connection.db;

    console.log('\n📊 ANÁLISIS PREVIO\n');

    // Contar appointments con token
    const appointmentsWithToken = await db.collection('appointments').countDocuments({
      cancelTokenHash: { $exists: true, $ne: null }
    });
    console.log(`📋 Appointments con token: ${appointmentsWithToken}`);

    // Contar reservations con token
    const reservationsWithToken = await db.collection('reservations').countDocuments({
      cancelTokenHash: { $exists: true, $ne: null }
    });
    console.log(`📋 Reservations con token: ${reservationsWithToken}`);

    const total = appointmentsWithToken + reservationsWithToken;

    if (total === 0) {
      console.log('\n✅ No hay tokens para migrar');
      return;
    }

    console.log(`\n⚠️  ATENCIÓN: Se migrarán ${total} tokens`);
    console.log('⚠️  Los tokens actuales quedarán INVÁLIDOS');
    console.log('⚠️  Se generarán NUEVOS tokens con SHA-256\n');

    // Esperar confirmación (comentar si quieres ejecución automática)
    console.log('💡 Para continuar, descomenta la línea de confirmación en el script\n');
    // Descomentar la siguiente línea para permitir la ejecución:
    // const confirmed = true;
    const confirmed = false;

    if (!confirmed) {
      console.log('❌ Migración cancelada (por seguridad)');
      console.log('💡 Edita el script y descomenta "const confirmed = true" para ejecutar');
      return;
    }

    console.log('🔄 Iniciando migración...\n');

    let appointmentsMigrated = 0;
    let appointmentsSkipped = 0;
    let reservationsMigrated = 0;
    let reservationsSkipped = 0;

    // Migrar Appointments
    if (appointmentsWithToken > 0) {
      console.log('📋 Migrando Appointments...');
      
      const appointments = await db.collection('appointments').find({
        cancelTokenHash: { $exists: true, $ne: null }
      }).toArray();

      for (const appointment of appointments) {
        try {
          // Generar nuevo token
          const newToken = crypto.randomBytes(32).toString('hex');
          const newHash = crypto.createHash('sha256').update(newToken).digest('hex');

          await db.collection('appointments').updateOne(
            { _id: appointment._id },
            { 
              $set: { 
                cancelTokenHash: newHash,
                // Guardar metadata de migración (opcional)
                cancelTokenMigrated: new Date()
              } 
            }
          );

          appointmentsMigrated++;
          
          if (appointmentsMigrated % 100 === 0) {
            console.log(`  ✅ ${appointmentsMigrated}/${appointmentsWithToken} appointments migrados...`);
          }
        } catch (error) {
          console.error(`  ❌ Error migrando appointment ${appointment._id}:`, error.message);
          appointmentsSkipped++;
        }
      }

      console.log(`  ✅ Appointments migrados: ${appointmentsMigrated}`);
      if (appointmentsSkipped > 0) {
        console.log(`  ⚠️  Appointments saltados: ${appointmentsSkipped}`);
      }
    }

    // Migrar Reservations
    if (reservationsWithToken > 0) {
      console.log('\n📋 Migrando Reservations...');
      
      const reservations = await db.collection('reservations').find({
        cancelTokenHash: { $exists: true, $ne: null }
      }).toArray();

      for (const reservation of reservations) {
        try {
          // Generar nuevo token
          const newToken = crypto.randomBytes(32).toString('hex');
          const newHash = crypto.createHash('sha256').update(newToken).digest('hex');

          await db.collection('reservations').updateOne(
            { _id: reservation._id },
            { 
              $set: { 
                cancelTokenHash: newHash,
                cancelTokenMigrated: new Date()
              } 
            }
          );

          reservationsMigrated++;
          
          if (reservationsMigrated % 100 === 0) {
            console.log(`  ✅ ${reservationsMigrated}/${reservationsWithToken} reservations migrados...`);
          }
        } catch (error) {
          console.error(`  ❌ Error migrando reservation ${reservation._id}:`, error.message);
          reservationsSkipped++;
        }
      }

      console.log(`  ✅ Reservations migrados: ${reservationsMigrated}`);
      if (reservationsSkipped > 0) {
        console.log(`  ⚠️  Reservations saltados: ${reservationsSkipped}`);
      }
    }

    console.log('\n✅ MIGRACIÓN COMPLETADA\n');
    console.log(`📊 Resumen:`);
    console.log(`  • Appointments migrados: ${appointmentsMigrated}`);
    console.log(`  • Reservations migrados: ${reservationsMigrated}`);
    console.log(`  • Total: ${appointmentsMigrated + reservationsMigrated}`);
    
    if (appointmentsSkipped + reservationsSkipped > 0) {
      console.log(`\n⚠️  Errores:`);
      console.log(`  • Appointments con error: ${appointmentsSkipped}`);
      console.log(`  • Reservations con error: ${reservationsSkipped}`);
    }

    console.log('\n⚠️  IMPORTANTE:');
    console.log('  • Los tokens antiguos ya NO son válidos');
    console.log('  • Los usuarios necesitarán nuevos tokens para cancelar');
    console.log('  • Considera reenviar links de cancelación si es necesario');

  } catch (error) {
    console.error('\n❌ Error durante la migración:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n👋 Conexión cerrada');
    process.exit(0);
  }
}

// Ejecutar
migrateCancelTokens();
