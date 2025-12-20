// scripts/checkMigration.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Client from '../src/models/clientModel.js';

dotenv.config({ path: '.env.development' });

async function checkMigrationStatus() {
  try {
    await mongoose.connect(process.env.DB_URI);
    console.log('✅ Conectado a MongoDB\n');
    
    const total = await Client.countDocuments();
    const withE164 = await Client.countDocuments({
      phone_e164: { $exists: true, $ne: '', $ne: null }
    });
    const withoutE164 = total - withE164;
    
    console.log('📊 ESTADO DE LA MIGRACIÓN:');
    console.log(`Total de clientes: ${total}`);
    console.log(`Con phone_e164: ${withE164} (${((withE164/total)*100).toFixed(1)}%)`);
    console.log(`Sin phone_e164: ${withoutE164} (${((withoutE164/total)*100).toFixed(1)}%)`);
    
    if (withoutE164 > 0) {
      console.log('\n📋 Ejemplos de clientes sin migrar:');
      const examples = await Client.find({
        $or: [
          { phone_e164: { $exists: false } },
          { phone_e164: null },
          { phone_e164: '' }
        ]
      }).limit(5).select('name phoneNumber phone_e164');
      
      examples.forEach(c => {
        console.log(`- ${c.name}: ${c.phoneNumber} (phone_e164: ${c.phone_e164 || 'N/A'})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
  }
}

checkMigrationStatus();
