// Crea los índices de appointments que usa la carga de agenda/caja/analíticas.
// Uso: node scripts/createAppointmentIndexes.js
//
// Sin ellos, GET /appointments/organization/:id/dates y las etiquetas
// "Sesión N de M" recorrían la colección entera (COLLSCAN) en cada carga.
// Están declarados también en appointmentModel.js (Mongoose los crea al
// arrancar con autoIndex); este script sirve para crearlos sin esperar un
// deploy y para verificar el plan de consulta.
//
// No usa syncIndexes(): borraría el índice compuesto
// {employee, organizationId, startDate, endDate, status}, que existe en la
// base pero no está declarado en el modelo.
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config({ path: `.env.${process.env.NODE_ENV || "development"}` });

const INDEXES = [
  { key: { organizationId: 1, startDate: 1 } },
  { key: { clientPackageId: 1 } },
];

await mongoose.connect(process.env.DB_URI);
const appointments = mongoose.connection.db.collection("appointments");

for (const { key } of INDEXES) {
  const t = Date.now();
  const name = await appointments.createIndex(key);
  console.log(`✅ ${name} (${Date.now() - t} ms)`);
}

const sample = await appointments.findOne({}, { projection: { organizationId: 1 } });
if (sample) {
  const plan = await appointments
    .find({ organizationId: sample.organizationId, startDate: { $gte: new Date(Date.now() - 30 * 864e5) } })
    .explain("executionStats");
  const stage = JSON.stringify(plan.queryPlanner.winningPlan).includes("IXSCAN") ? "IXSCAN" : "COLLSCAN";
  console.log(`Plan citas por org+fecha: ${stage}, docs examinados: ${plan.executionStats.totalDocsExamined}`);
}

console.log("Índices actuales:", (await appointments.indexes()).map((i) => i.name).join(", "));
await mongoose.disconnect();
