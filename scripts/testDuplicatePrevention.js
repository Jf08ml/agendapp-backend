// scripts/testDuplicatePrevention.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Client from '../src/models/clientModel.js';

dotenv.config({ path: '.env.development' });

async function testDuplicatePrevention() {
  try {
    console.log('🧪 Probando prevención de duplicados...\n');
    
    await mongoose.connect(process.env.DB_URI);
    console.log('✅ Conectado a MongoDB\n');
    
    // Buscar una organización y un cliente existente
    const existingClient = await Client.findOne({ phone_e164: { $exists: true, $ne: null } })
      .select('phone_e164 organizationId name');
    
    if (!existingClient) {
      console.log('❌ No se encontró ningún cliente con phone_e164 para probar');
      return;
    }
    
    console.log('📋 Cliente de prueba:');
    console.log(`   Nombre: ${existingClient.name}`);
    console.log(`   Teléfono: ${existingClient.phone_e164}`);
    console.log(`   Organización: ${existingClient.organizationId}\n`);
    
    console.log('🔄 Intentando crear duplicado...');
    
    try {
      const duplicate = new Client({
        name: 'TEST - Cliente Duplicado',
        phoneNumber: existingClient.phone_e164,
        phone_e164: existingClient.phone_e164,
        phone_country: 'CO',
        organizationId: existingClient.organizationId
      });
      
      await duplicate.save();
      console.log('❌ ERROR: Se permitió crear un duplicado (no debería llegar aquí)');
      
    } catch (error) {
      if (error.code === 11000) {
        console.log('✅ ¡Prevención de duplicados funcionando!');
        console.log('   MongoDB rechazó el duplicado correctamente');
        console.log(`   Error: ${error.message}\n`);
      } else {
        throw error;
      }
    }
    
    // Probar que SÍ se puede crear un cliente con el MISMO teléfono en OTRA organización
    console.log('🔄 Probando mismo teléfono en DIFERENTE organización...');
    
    const otherOrg = await Client.findOne({ 
      organizationId: { $ne: existingClient.organizationId } 
    }).select('organizationId');
    
    if (otherOrg) {
      try {
        const samePhoneDifferentOrg = new Client({
          name: 'TEST - Mismo teléfono, otra org',
          phoneNumber: existingClient.phone_e164,
          phone_e164: existingClient.phone_e164,
          phone_country: 'CO',
          organizationId: otherOrg.organizationId
        });
        
        await samePhoneDifferentOrg.save();
        console.log('✅ Permitió mismo teléfono en diferente organización (correcto)');
        
        // Limpiar el registro de prueba
        await Client.deleteOne({ _id: samePhoneDifferentOrg._id });
        console.log('   Registro de prueba eliminado\n');
        
      } catch (error) {
        console.log('⚠️ Error al probar diferente organización:', error.message);
      }
    }
    
    console.log('✨ Pruebas completadas exitosamente!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Conexión a MongoDB cerrada');
  }
}

testDuplicatePrevention();
