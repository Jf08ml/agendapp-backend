/**
 * scripts/diagnoseImpactReportViability.js
 *
 * DIAGNÓSTICO READ-ONLY (no escribe nada). Mide si los datos existentes aguantan
 * un "reporte de impacto" por organización (más citas, menos ausencias, reservas
 * que llegan solas) antes de invertir en construirlo.
 *
 * Responde 3 preguntas:
 *   1. ¿Los negocios realmente marcan no_show / attended? (si no, la métrica de
 *      ausencias es ruido y no se puede mostrar).
 *   2. ¿Cuántas orgs tienen suficiente historia + volumen para un reporte creíble?
 *   3. ¿Qué adopción hay de reservas online (reservationId) y confirmación por
 *      link público (clientConfirmed)?
 *
 * Solo considera citas PASADAS (startDate < ahora) para el análisis de ausencias:
 * una cita futura está naturalmente en pending/confirmed y contaminaría el ratio.
 *
 * Uso: NODE_ENV=production node scripts/diagnoseImpactReportViability.js
 *      (o NODE_ENV=development)
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import Organization from "../src/models/organizationModel.js";
import Appointment from "../src/models/appointmentModel.js";

dotenv.config({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env.development",
});

// Umbrales para que una org sea "elegible" para el reporte
const MIN_AGE_DAYS = 45;       // antigüedad mínima de la org
const MIN_PAST_APPTS = 20;     // volumen mínimo de citas pasadas
// Una org "registra ausencias de verdad" si marca no_show con señal real.
// OJO: NO basta con que esté "resuelto" (attended), porque casi todas marcan
// attended pero NO marcan no_show. Hay que gatear por no_show específicamente.
const MIN_NOSHOW_COUNT = 3;    // mínimo absoluto de citas marcadas no_show
const MIN_NOSHOW_RATIO = 0.05; // ≥5% de ausencias sobre lo resuelto (algo creíble)

const CANCELLED_STATUSES = ["cancelled", "cancelled_by_customer", "cancelled_by_admin"];

const pct = (n, d) => (d > 0 ? ((n / d) * 100) : 0);
const fmtPct = (n, d) => `${pct(n, d).toFixed(0)}%`;

async function run() {
  await mongoose.connect(process.env.DB_URI);
  console.log("✓ Conectado a Mongo.\n");

  const now = new Date();

  // ── 1. Distribución global de status (solo citas pasadas) ─────────────────
  const globalStatus = await Appointment.aggregate([
    { $match: { startDate: { $lt: now } } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  const globalTotal = globalStatus.reduce((s, r) => s + r.count, 0);

  console.log("══════════════════════════════════════════════════════════");
  console.log("1) DISTRIBUCIÓN GLOBAL DE STATUS (citas pasadas)");
  console.log("══════════════════════════════════════════════════════════");
  for (const row of globalStatus) {
    console.log(`  ${String(row._id || "(null)").padEnd(22)} ${String(row.count).padStart(7)}  ${fmtPct(row.count, globalTotal).padStart(5)}`);
  }
  console.log(`  ${"TOTAL".padEnd(22)} ${String(globalTotal).padStart(7)}`);
  const globalResolved = globalStatus
    .filter((r) => r._id === "attended" || r._id === "no_show")
    .reduce((s, r) => s + r.count, 0);
  console.log(`\n  → ${fmtPct(globalResolved, globalTotal)} de las citas pasadas están RESUELTAS (attended/no_show).`);
  console.log("    Si esto es bajo, la métrica de ausencias global no es confiable.\n");

  // ── 2. Agregado por organización ──────────────────────────────────────────
  const perOrg = await Appointment.aggregate([
    { $match: { startDate: { $lt: now } } },
    {
      $group: {
        _id: "$organizationId",
        total: { $sum: 1 },
        noShow: { $sum: { $cond: [{ $eq: ["$status", "no_show"] }, 1, 0] } },
        attended: { $sum: { $cond: [{ $eq: ["$status", "attended"] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $in: ["$status", CANCELLED_STATUSES] }, 1, 0] } },
        online: { $sum: { $cond: [{ $ne: ["$reservationId", null] }, 1, 0] } },
        confirmed: { $sum: { $cond: ["$clientConfirmed", 1, 0] } },
      },
    },
  ]);

  // Mapa org -> { name, regDate } con fallback de fecha por ObjectId
  const orgs = await Organization.find({}).select("name createdAt").lean();
  const orgMap = new Map();
  for (const o of orgs) {
    const regDate = o.createdAt || o._id.getTimestamp();
    orgMap.set(String(o._id), { name: o.name || "(sin nombre)", regDate });
  }

  const rows = perOrg.map((r) => {
    const meta = orgMap.get(String(r._id)) || { name: "(org borrada)", regDate: r._id.getTimestamp?.() || now };
    const ageDays = Math.floor((now - meta.regDate) / 86400000);
    const resolved = r.noShow + r.attended;
    return {
      name: meta.name,
      ageDays,
      total: r.total,
      resolvedRatio: pct(resolved, r.total) / 100,
      noShowRatio: pct(r.noShow, resolved) / 100, // ausencias sobre lo resuelto
      onlineRatio: pct(r.online, r.total) / 100,
      confirmedRatio: pct(r.confirmed, r.total) / 100,
      noShow: r.noShow,
      attended: r.attended,
      online: r.online,
    };
  });

  // ── 3. Elegibilidad para el reporte ───────────────────────────────────────
  const eligible = rows.filter((r) => r.ageDays >= MIN_AGE_DAYS && r.total >= MIN_PAST_APPTS);
  // Gating ESPECÍFICO de no_show: la org realmente registra ausencias.
  const withRealNoShow = eligible.filter(
    (r) => r.noShow >= MIN_NOSHOW_COUNT && r.noShowRatio >= MIN_NOSHOW_RATIO
  );
  const withOnline = eligible.filter((r) => r.online > 0);

  console.log("══════════════════════════════════════════════════════════");
  console.log("2) ELEGIBILIDAD PARA EL REPORTE DE IMPACTO");
  console.log(`   (antigüedad ≥ ${MIN_AGE_DAYS} días Y ≥ ${MIN_PAST_APPTS} citas pasadas)`);
  console.log("══════════════════════════════════════════════════════════");
  console.log(`  Orgs con citas pasadas:            ${rows.length}`);
  console.log(`  Orgs ELEGIBLES (edad + volumen):   ${eligible.length}`);
  console.log(`  ├─ que REGISTRAN ausencias (≥${MIN_NOSHOW_COUNT} no_show Y ≥${(MIN_NOSHOW_RATIO * 100).toFixed(0)}%): ${withRealNoShow.length}  ← reporte CON bloque de ausencias`);
  console.log(`  └─ con ≥1 reserva online:          ${withOnline.length}  ← reporte CON "reservas que llegan solas"\n`);

  if (withRealNoShow.length > 0) {
    console.log("  Orgs que SÍ aguantan el bloque de ausencias:");
    for (const r of withRealNoShow.sort((a, b) => b.noShowRatio - a.noShowRatio)) {
      console.log(`    • ${r.name.slice(0, 28).padEnd(29)} ${r.noShow} no_show  (${fmtPct(r.noShowRatio, 1)} de lo resuelto)`);
    }
    console.log("");
  }

  // ── 4. Tabla de orgs elegibles (top 40 por volumen) ───────────────────────
  console.log("══════════════════════════════════════════════════════════");
  console.log("3) ORGS ELEGIBLES (top 40 por volumen de citas pasadas)");
  console.log("══════════════════════════════════════════════════════════");
  console.log(
    "  " +
      "Negocio".padEnd(26) +
      "edad".padStart(6) +
      "citas".padStart(7) +
      "resuel".padStart(8) +
      "no_show".padStart(9) +
      "online".padStart(8) +
      "confirm".padStart(9)
  );
  const sorted = [...eligible].sort((a, b) => b.total - a.total).slice(0, 40);
  for (const r of sorted) {
    console.log(
      "  " +
        r.name.slice(0, 25).padEnd(26) +
        `${r.ageDays}d`.padStart(6) +
        String(r.total).padStart(7) +
        fmtPct(r.resolvedRatio, 1).padStart(8) +
        (r.resolvedRatio > 0 ? fmtPct(r.noShowRatio, 1) : "  -").padStart(9) +
        fmtPct(r.onlineRatio, 1).padStart(8) +
        fmtPct(r.confirmedRatio, 1).padStart(9)
    );
  }

  console.log("\n  Leyenda: resuel = % de citas marcadas attended/no_show |");
  console.log("           no_show = ausencias sobre lo resuelto |");
  console.log("           online = % de citas que vinieron de reserva pública |");
  console.log("           confirm = % con confirmación por link (clientConfirmed)\n");

  // ── Veredicto ─────────────────────────────────────────────────────────────
  console.log("══════════════════════════════════════════════════════════");
  console.log("VEREDICTO");
  console.log("══════════════════════════════════════════════════════════");
  const shareRealNoShow = pct(withRealNoShow.length, eligible.length);
  const shareOnline = pct(withOnline.length, eligible.length);
  console.log(`  • Métrica "menos ausencias": solo ${shareRealNoShow.toFixed(0)}% de orgs registran no_show de verdad.`);
  console.log(`    ${shareRealNoShow >= 50 ? "✓ Apóyate en ella." : "⚠ Bloque OPCIONAL — enciéndelo solo en las orgs listadas arriba, ocúltalo en el resto."}`);
  console.log(`  • Métrica "reservas que llegan solas": viable en ${shareOnline.toFixed(0)}% de orgs elegibles. ← titular estrella.`);
  console.log(`  • Métrica "más citas": siempre viable (no depende de status). ← titular universal.`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("✖ Error:", err);
  process.exit(1);
});
