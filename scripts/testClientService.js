// scripts/testClientService.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import clientService from '../src/services/clientService.js';
import Client from '../src/models/clientModel.js';
import Organization from '../src/models/organizationModel.js';

dotenv.config({ path: '.env.development' });

async function testClientService() {
  try {
    console.log('🧪 Probando clientService con mensajes de error amigables...\n');
    
    await mongoose.connect(process.env.DB_URI);
    console.log('✅ Conectado a MongoDB\n');
    
    // Obtener una organización existente
    const org = await Organization.findOne();
    if (!org) {
      console.log('❌ No se encontró ninguna organización');
      return;
    }
    
    console.log(`📋 Organización: ${org.name} (${org._id})\n`);
    
    // Crear un cliente de prueba
    console.log('🔄 Paso 1: Crear cliente inicial...');
    const testPhone = '+573999999999'; // Número único para prueba
    
    try {
      const client1 = await clientService.createClient({
        name: 'TEST - Cliente Original',
        email: 'test@test.com',
        phoneNumber: testPhone,
        organizationId: org._id,
        birthDate: null
      });
      
      console.log(`✅ Cliente creado: ${client1.name}`);
      console.log(`   Teléfono E.164: ${client1.phone_e164}\n`);
      
      // Intentar crear duplicado
      console.log('🔄 Paso 2: Intentar crear duplicado...');
      
      try {
        await clientService.createClient({
          name: 'TEST - Cliente Duplicado',
          email: 'test2@test.com',
          phoneNumber: testPhone,
          organizationId: org._id,
          birthDate: null
        });
        
        console.log('❌ ERROR: Se permitió crear duplicado');
        
      } catch (error) {
        console.log('✅ Duplicado rechazado correctamente');
        console.log(`   Mensaje al usuario: "${error.message}"\n`);
      }
      
      // Crear cliente con mismo teléfono en otra organización
      const org2 = await Organization.findOne({ _id: { $ne: org._id } });
      
      if (org2) {
        console.log('🔄 Paso 3: Crear cliente con mismo teléfono en otra organización...');
        
        try {
          const client3 = await clientService.createClient({
            name: 'TEST - Cliente Otra Org',
            email: 'test3@test.com',
            phoneNumber: testPhone,
            organizationId: org2._id,
            birthDate: null
          });
          
          console.log(`✅ Permitido en diferente organización: ${client3.name}`);
          console.log(`   Organización: ${org2.name}\n`);
          
          // Limpiar
          await Client.deleteOne({ _id: client3._id });
          
        } catch (error) {
          console.log('⚠️ Error inesperado:', error.message, '\n');
        }
      }
      
      // Limpiar cliente de prueba
      await Client.deleteOne({ _id: client1._id });
      console.log('🧹 Clientes de prueba eliminados\n');
      
    } catch (error) {
      console.log('⚠️ Error en prueba:', error.message);
    }
    
    console.log('✨ Pruebas completadas!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Conexión a MongoDB cerrada');
  }
}

testClientService();
