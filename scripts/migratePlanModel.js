// scripts/migratePlanModel.js
// Migración para simplificar el modelo de Plan
// Convierte prices.USD/prices.COP y payment.prices a price/currency unificados

import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV || "development"}` });

import dbConnection from "../src/config/db.js";
import planModel from "../src/models/planModel.js";

async function migratePlans() {
  try {
    await dbConnection();
    console.log("✓ Conectado a la base de datos\n");

    const plans = await planModel.find();
    console.log(`📦 Encontrados ${plans.length} planes para migrar\n`);

    let migrated = 0;
    let skipped = 0;

    for (const plan of plans) {
      console.log(`\n🔄 Procesando: ${plan.displayName}`);
      
      let needsUpdate = false;
      const updates = {};

      // 1. Migrar de prices.USD/prices.COP a price/currency
      if (plan.prices) {
        if (plan.prices.USD) {
          updates.price = plan.prices.USD;
          updates.currency = "USD";
          needsUpdate = true;
          console.log(`  ✓ Precio USD encontrado: $${plan.prices.USD}`);
        } else if (plan.prices.COP) {
          updates.price = plan.prices.COP;
          updates.currency = "COP";
          needsUpdate = true;
          console.log(`  ✓ Precio COP encontrado: $${plan.prices.COP}`);
        }
      }

      // 2. Si no hay currency definido, usar USD por defecto
      if (!plan.currency && !updates.currency) {
        updates.currency = "USD";
        needsUpdate = true;
        console.log(`  ℹ️ Asignando moneda por defecto: USD`);
      }

      // 3. Limpiar campos obsoletos
      if (plan.prices !== undefined) {
        updates.$unset = { prices: "" };
        needsUpdate = true;
        console.log(`  🗑️ Eliminando campo 'prices'`);
      }

      if (plan.payment && plan.payment.prices) {
        if (!updates.$unset) updates.$unset = {};
        updates.$unset["payment.prices"] = "";
        needsUpdate = true;
        console.log(`  🗑️ Eliminando campo 'payment.prices'`);
      }

      // 4. Aplicar actualizaciones
      if (needsUpdate) {
        await planModel.updateOne({ _id: plan._id }, updates);
        migrated++;
        console.log(`  ✅ Plan migrado exitosamente`);
      } else {
        skipped++;
        console.log(`  ⏭️ Plan ya está actualizado, saltando`);
      }
    }

    console.log(`\n\n📊 Resumen de migración:`);
    console.log(`  • Total de planes: ${plans.length}`);
    console.log(`  • Migrados: ${migrated}`);
    console.log(`  • Saltados: ${skipped}`);
    console.log(`\n✅ Migración completada!\n`);

    // Mostrar planes actualizados
    const updatedPlans = await planModel.find();
    console.log(`📋 Planes después de la migración:\n`);
    updatedPlans.forEach((p) => {
      console.log(`  • ${p.displayName}`);
      console.log(`    - Precio: $${p.price} ${p.currency}`);
      console.log(`    - ProductId: ${p.payment?.productId || "N/A"}`);
      console.log(``);
    });

    process.exit(0);
  } catch (error) {
    console.error("❌ Error en la migración:", error);
    process.exit(1);
  }
}

migratePlans();
