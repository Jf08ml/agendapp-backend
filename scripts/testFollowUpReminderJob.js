/**
 * scripts/testFollowUpReminderJob.js
 *
 * Dispara manualmente el job de recordatorios de seguimiento entre servicios
 * (sin esperar a las 10 AM). Ejecuta el job REAL de producción para TODAS las
 * organizaciones con membresía activa/trial — si alguna tiene candidatos
 * pendientes hoy, les manda WhatsApp de verdad. No es un dry-run.
 *
 * Uso: node -r @babel/register scripts/testFollowUpReminderJob.js
 *      (o NODE_ENV=production node -r @babel/register scripts/testFollowUpReminderJob.js)
 *
 * Nota: el job se carga con import() dinámico DESPUÉS de dotenv.config(), porque
 * sendWhatsappService.js lee process.env.WA_API_URL al cargarse. Si se importara
 * de forma estática (hoisted), correría antes de configurar las env y la URL de
 * WhatsApp quedaría vacía ("Invalid URL").
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
// Registrar modelos referenciados por populate — no leen env
import "../src/models/roleModel.js";
import "../src/models/planModel.js";
import "../src/models/clientModel.js";
import "../src/models/employeeModel.js";

dotenv.config({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env.development",
});

async function run() {
  await mongoose.connect(process.env.DB_URI);
  console.log("✓ Conectado a Mongo.");

  const { runFollowUpReminders } = await import("../src/cron/followUpReminderJob.js");

  const result = await runFollowUpReminders();
  console.log("\n✓ Resultado:", result);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
