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

    // 1. Índice compuesto para búsqueda de appointments con token de cancelación
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
    console.log('✅ Índice creado: cancelTokenHash_startDate_idx');

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

    // 3. Índice compuesto para reservations con token de cancelación
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
    console.log('\n💡 Beneficios:');
    console.log('  • Búsqueda de tokens hasta 10x más rápida');
    console.log('  • Filtrado por fecha optimizado');
    console.log('  • Búsqueda de grupos de citas instantánea');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n👋 Conexión cerrada');
    process.exit(0);
  }
}

createCancellationIndexes();
