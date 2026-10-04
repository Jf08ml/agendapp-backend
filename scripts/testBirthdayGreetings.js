/**
 * scripts/testBirthdayGreetings.js
 *
 * Dispara manualmente el job de saludos de cumpleaños (sin esperar a las 9 AM).
 * Útil para probar end-to-end con un cliente cuyo cumpleaños sea hoy.
 *
 * Uso: node -r @babel/register scripts/testBirthdayGreetings.js
 *      (o NODE_ENV=production node -r @babel/register scripts/testBirthdayGreetings.js)
 *
 * Nota: el job se carga con import() dinámico DESPUÉS de dotenv.config(), porque
 * sendWhatsappService.js lee process.env.WA_API_URL al cargarse. Si se importara
 * de forma estática (hoisted), correría antes de configurar las env y la URL de
 * WhatsApp quedaría vacía ("Invalid URL").
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
// Registrar modelos referenciados por populate (role/plan) — no leen env
import "../src/models/roleModel.js";
import "../src/models/planModel.js";

dotenv.config({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env.development",
});

async function run() {
  await mongoose.connect(process.env.DB_URI);
  console.log("✓ Conectado a Mongo.");

  // Import dinámico: ahora process.env ya está cargado
  const { runBirthdayGreetings } = await import("../src/cron/birthdayJob.js");

  const result = await runBirthdayGreetings();
  console.log("\n✓ Resultado:", result);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("✖ Error:", err);
  process.exit(1);
});
