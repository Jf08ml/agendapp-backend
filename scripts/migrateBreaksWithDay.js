/**
 * Script para migrar breaks existentes sin campo 'day'
 * Agrega el campo 'day' a cada break replicándolo para todos los días laborables
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import connectDB from "../src/config/db.js";
import Organization from "../src/models/organizationModel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function migrateBreaksWithDay() {
  try {
    console.log("🔌 Conectando a MongoDB...");
    await connectDB();
    console.log("✅ Conexión exitosa\n");

    // Buscar organizaciones con breaks sin el campo 'day'
    const orgs = await Organization.find({
      "openingHours.breaks": { $exists: true, $ne: [] }
    });

    console.log(`📋 Organizaciones encontradas con breaks: ${orgs.length}\n`);

    let migratedCount = 0;
    let alreadyMigratedCount = 0;

    for (const org of orgs) {
      const breaks = org.openingHours?.breaks || [];
      
      // Verificar si hay breaks sin el campo 'day'
      const breaksWithoutDay = breaks.filter(b => b.day === undefined || b.day === null);
      
      if (breaksWithoutDay.length === 0) {
        console.log(`✓ ${org.name}: Breaks ya tienen el campo 'day'`);
        alreadyMigratedCount++;
        continue;
      }

      console.log(`🔧 Migrando ${org.name}...`);
      console.log(`   Breaks sin 'day': ${breaksWithoutDay.length}`);
      
      // Obtener días laborables
      const businessDays = org.openingHours?.businessDays || [1, 2, 3, 4, 5];
      console.log(`   Días laborables: [${businessDays.join(', ')}]`);

      // Crear nuevos breaks con el campo 'day' para cada día laborable
      const newBreaks = [];
      
      for (const originalBreak of breaks) {
        if (originalBreak.day !== undefined && originalBreak.day !== null) {
          // Ya tiene day, mantenerlo
          newBreaks.push(originalBreak);
        } else {
          // No tiene day, replicarlo para cada día laborable
          for (const day of businessDays) {
            newBreaks.push({
              day: day,
              start: originalBreak.start,
              end: originalBreak.end,
              note: originalBreak.note
            });
          }
        }
      }

      console.log(`   Nuevos breaks creados: ${newBreaks.length}`);

      // Actualizar la organización
      org.openingHours.breaks = newBreaks;
      await org.save();

      console.log(`✅ ${org.name} migrado exitosamente\n`);
      migratedCount++;
    }

    console.log("\n📊 Resumen de migración:");
    console.log(`   ✅ Organizaciones migradas: ${migratedCount}`);
    console.log(`   ✓ Ya estaban migradas: ${alreadyMigratedCount}`);
    console.log(`   📋 Total procesadas: ${orgs.length}`);

  } catch (error) {
    console.error("❌ Error durante la migración:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("\n🔌 Desconectado de MongoDB");
    process.exit(0);
  }
}

migrateBreaksWithDay();
