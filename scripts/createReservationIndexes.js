// scripts/createReservationIndexes.js
// Crea el índice { organizationId: 1, startDate: 1 } en Reservation, usado por
// el listado paginado de /gestionar-reservas-online (ver reservationService.js).
// Uso: NODE_ENV=production node scripts/createReservationIndexes.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import Reservation from "../src/models/reservationModel.js";

dotenv.config({ path: `.env.${process.env.NODE_ENV || "development"}` });

async function createReservationIndexes() {
  try {
    console.log("🚀 Iniciando creación de índices de Reservation...\n");

    await mongoose.connect(process.env.DB_URI);
    console.log("✅ Conectado a MongoDB\n");

    const existingIndexes = await Reservation.collection.getIndexes();
    console.log("📋 Índices existentes:");
    Object.keys(existingIndexes).forEach((indexName) => {
      console.log(`  - ${indexName}`);
    });

    console.log("\n🔨 Sincronizando índices definidos en el schema...");
    await Reservation.syncIndexes();
    console.log("✅ Índices sincronizados correctamente\n");

    const finalIndexes = await Reservation.collection.getIndexes();
    console.log("📋 Índices finales:");
    Object.keys(finalIndexes).forEach((indexName) => {
      console.log(`  - ${indexName}:`, JSON.stringify(finalIndexes[indexName]));
    });

    console.log("\n✨ Proceso completado exitosamente!");
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log("\n🔌 Conexión a MongoDB cerrada");
  }
}

createReservationIndexes();
