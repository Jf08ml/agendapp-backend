// Diagnóstico: reservas recientes de una org y por qué quedaron pendientes.
// Uso: node scripts/diagnoseReservationsOrg.js <slug> [dias=30]
import dotenv from "dotenv";
import mongoose from "mongoose";
dotenv.config({ path: `.env.${process.env.NODE_ENV || "development"}` });

const slug = process.argv[2];
const days = Number(process.argv[3] || 30);
if (!slug) { console.error("Uso: node scripts/diagnoseReservationsOrg.js <slug> [dias]"); process.exit(1); }

await mongoose.connect(process.env.DB_URI);
const db = mongoose.connection.db;
const org = await db.collection("organizations").findOne({ $or: [{ slug }, { domains: { $regex: slug } }] });
if (!org) { console.error("Org no encontrada"); process.exit(1); }
console.log("Org:", org.name, org._id.toString());
console.log("reservationPolicy:", org.reservationPolicy, "| tz:", org.timezone);
console.log("depositRequired:", org.depositRequired, org.reservationDeposit ?? "", "| mpCollect.connected:", org.mpCollect?.connected);

const since = new Date(Date.now() - days * 864e5);
const res = await db.collection("reservations").find({ organizationId: org._id, createdAt: { $gte: since } }).sort({ createdAt: -1 }).toArray();
const byStatus = {};
for (const r of res) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
console.log(`Reservas últimos ${days} días:`, res.length, byStatus);

const emps = Object.fromEntries((await db.collection("employees").find({ organizationId: org._id }).project({ names: 1 }).toArray()).map(e => [e._id.toString(), e.names]));
const svcs = Object.fromEntries((await db.collection("services").find({ organizationId: org._id }).project({ name: 1 }).toArray()).map(s => [s._id.toString(), s.name]));
for (const r of res.slice(0, 40)) {
  console.log([
    r.createdAt?.toISOString(), r.status, r.source || "-", r.auto ? "auto" : "",
    "inicio:", r.startDate?.toISOString(),
    "svc:", svcs[r.serviceId?.toString()] || r.serviceId,
    "emp:", r.employeeId ? (emps[r.employeeId.toString()] || r.employeeId) : "SIN EMPLEADO",
    r.orderId ? `order:${r.orderId}` : "",
    r.errorMessage ? `ERROR: ${r.errorMessage}` : "",
  ].join(" | "));
}
await mongoose.disconnect();
