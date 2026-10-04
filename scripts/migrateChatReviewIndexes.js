// scripts/migrateChatReviewIndexes.js
// Sincroniza los índices de ChatLog y WaBotMessage tras agregar el campo
// `review` y el TTL con partialFilterExpression (ver chatLogModel.js /
// waBotMessageModel.js). syncIndexes() borra el índice createdAt_1 viejo de
// ChatLog (opciones distintas) y lo recrea con el nuevo partialFilterExpression;
// para WaBotMessage simplemente crea el TTL que antes no existía.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ChatLog from '../src/models/chatLogModel.js';
import WaBotMessage from '../src/models/waBotMessageModel.js';

dotenv.config({ path: `.env.${process.env.NODE_ENV || 'development'}` });

async function migrate() {
  try {
    console.log('🚀 Sincronizando índices de ChatLog y WaBotMessage...\n');

    await mongoose.connect(process.env.DB_URI);
    console.log('✅ Conectado a MongoDB\n');

    for (const Model of [ChatLog, WaBotMessage]) {
      const name = Model.modelName;
      console.log(`📋 Índices actuales de ${name}:`);
      const before = await Model.collection.getIndexes({ full: true });
      before.forEach((idx) => console.log(`  - ${idx.name}:`, JSON.stringify(idx.key), idx.expireAfterSeconds !== undefined ? `TTL=${idx.expireAfterSeconds}s` : '', idx.partialFilterExpression ? JSON.stringify(idx.partialFilterExpression) : ''));

      const result = await Model.syncIndexes();
      console.log(`🔨 syncIndexes(${name}):`, result);

      const after = await Model.collection.getIndexes({ full: true });
      console.log(`📋 Índices finales de ${name}:`);
      after.forEach((idx) => console.log(`  - ${idx.name}:`, JSON.stringify(idx.key), idx.expireAfterSeconds !== undefined ? `TTL=${idx.expireAfterSeconds}s` : '', idx.partialFilterExpression ? JSON.stringify(idx.partialFilterExpression) : ''));
      console.log('');
    }

    console.log('✨ Migración de índices completada exitosamente!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Conexión a MongoDB cerrada');
  }
}

migrate();
