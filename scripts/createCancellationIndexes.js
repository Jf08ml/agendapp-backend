import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/agendaDB';

async function createCancellationIndexes() {
  try {
    console.log('🔌 Conectando a MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB');

    const db = mongoose.connection.db;

    // 1. Índice para búsqueda rápida de cancelTokenHash en appointments
    // NO ÚNICO porque durante la migración pueden coexistir bcrypt y SHA-256
    console.log('\n📊 Creando índice para cancelTokenHash + startDate en appointments...');
    await db.collection('appointments').createIndex(
      { 
        cancelTokenHash: 1,
        startDate: -1 
      },
      { 
        name: 'cancelTokenHash_startDate_idx',
        partialFilterExpression: { 
          cancelTokenHash: { $exists: true } 
        }
      }
    );
    console.log('✅ Índice creado: cancelTokenHash_startDate_idx (permite SHA-256 y bcrypt)');

    // 2. Índice para groupId (búsqueda de citas recurrentes)
    console.log('\n📊 Creando índice para groupId en appointments...');
    await db.collection('appointments').createIndex(
      { groupId: 1 },
      { 
        name: 'groupId_idx',
        partialFilterExpression: { 
          groupId: { $exists: true } 
        }
      }
    );
    console.log('✅ Índice creado: groupId_idx');

    // 3. Índice para cancelTokenHash + startDate en reservations
    console.log('\n📊 Creando índice para cancelTokenHash + startDate en reservations...');
    await db.collection('reservations').createIndex(
      { 
        cancelTokenHash: 1,
        startDate: -1 
      },
      { 
        name: 'cancelTokenHash_startDate_idx',
        partialFilterExpression: { 
          cancelTokenHash: { $exists: true } 
        }
      }
    );
    console.log('✅ Índice creado: cancelTokenHash_startDate_idx (reservations)');

    // 4. Índice para appointmentId en reservations (búsqueda rápida de reservas asociadas)
    console.log('\n📊 Creando índice para appointmentId en reservations...');
    await db.collection('reservations').createIndex(
      { appointmentId: 1 },
      { 
        name: 'appointmentId_idx',
        partialFilterExpression: { 
          appointmentId: { $exists: true } 
        }
      }
    );
    console.log('✅ Índice creado: appointmentId_idx');

    // Listar todos los índices creados
    console.log('\n📋 Índices en appointments:');
    const appointmentIndexes = await db.collection('appointments').indexes();
    appointmentIndexes.forEach(idx => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    console.log('\n📋 Índices en reservations:');
    const reservationIndexes = await db.collection('reservations').indexes();
    reservationIndexes.forEach(idx => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    console.log('\n✅ Todos los índices de cancelación creados exitosamente');
    console.log('\n💡 Sistema de tokens optimizado:');
    console.log('  • Nuevas reservas usan SHA-256 (búsqueda directa, ~100ms)');
    console.log('  • Tokens antiguos (bcrypt) siguen funcionando (fallback automático)');
    console.log('  • Migración automática cuando se use un token antiguo');
    console.log('  • Índices optimizados para ambos sistemas');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n👋 Conexión cerrada');
    process.exit(0);
  }
}

createCancellationIndexes();
