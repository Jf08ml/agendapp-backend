/**
 * Script de migración: Mover whatsappTemplates de Organization a colección WhatsappTemplate
 * 
 * Este script:
 * 1. Busca todas las organizaciones que tengan whatsappTemplates
 * 2. Crea documentos en la colección WhatsappTemplate
 * 3. (Opcional) Limpia el campo whatsappTemplates de Organization
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import Organization from "../src/models/organizationModel.js";
import WhatsappTemplate from "../src/models/whatsappTemplateModel.js";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

async function migrateTemplates() {
  try {
    console.log("🔄 Conectando a MongoDB...");
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Conectado a MongoDB");

    // Buscar todas las organizaciones que tengan whatsappTemplates
    const organizations = await Organization.find({
      whatsappTemplates: { $exists: true, $ne: null }
    });

    console.log(`\n📊 Encontradas ${organizations.length} organizaciones con templates personalizados\n`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const org of organizations) {
      try {
        // Verificar si tiene algún template personalizado (no null)
        const hasCustomTemplates = Object.values(org.whatsappTemplates || {}).some(t => t !== null);
        
        if (!hasCustomTemplates) {
          console.log(`⏭️  ${org.name}: Sin templates personalizados, omitiendo...`);
          skipped++;
          continue;
        }

        // Verificar si ya existe un documento de templates
        const existingTemplate = await WhatsappTemplate.findOne({ 
          organizationId: org._id 
        });

        if (existingTemplate) {
          console.log(`⚠️  ${org.name}: Ya existe documento de templates, omitiendo...`);
          skipped++;
          continue;
        }

        // Crear nuevo documento de templates
        const newTemplate = new WhatsappTemplate({
          organizationId: org._id,
          scheduleAppointment: org.whatsappTemplates.scheduleAppointment || null,
          scheduleAppointmentBatch: org.whatsappTemplates.scheduleAppointmentBatch || null,
          reminder: org.whatsappTemplates.reminder || null,
          statusReservationApproved: org.whatsappTemplates.statusReservationApproved || null,
          statusReservationRejected: org.whatsappTemplates.statusReservationRejected || null,
        });

        await newTemplate.save();
        console.log(`✅ ${org.name}: Templates migrados exitosamente`);
        migrated++;

        // Opcional: Descomentar para limpiar el campo de Organization
        // org.whatsappTemplates = undefined;
        // await org.save();

      } catch (error) {
        console.error(`❌ ${org.name}: Error - ${error.message}`);
        errors++;
      }
    }

    console.log(`\n📈 Resumen de migración:`);
    console.log(`   ✅ Migrados: ${migrated}`);
    console.log(`   ⏭️  Omitidos: ${skipped}`);
    console.log(`   ❌ Errores: ${errors}`);
    console.log(`   📊 Total procesados: ${organizations.length}\n`);

    console.log("✅ Migración completada");
    
  } catch (error) {
    console.error("❌ Error durante la migración:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("👋 Desconectado de MongoDB");
  }
}

// Ejecutar migración
migrateTemplates();
