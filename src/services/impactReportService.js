// src/services/impactReportService.js
//
// Calcula el "reporte de impacto" de una organización: cuánto valor le ha dado
// AgenditApp desde que se registró. Solo usa citas PASADAS (startDate < ahora).
//
// Métricas (ver diagnóstico scripts/diagnoseImpactReportViability.js):
//   • Más citas  → siempre viable (volumen + tendencia mensual).
//   • Reservas que llegan solas (reservationId) → titular estrella.
//   • Menos ausencias (no_show) → BLOQUE OPCIONAL: solo se enciende cuando la org
//     realmente registra no_show (la mayoría no lo hace y un 0% sería engañoso).
//
// Fase 1+2: este servicio alimenta el preview superadmin (GET /admin/impact-reports).
// `computeOrgImpactReport` queda listo para el flujo cara-al-cliente (fase 3).

import Organization from "../models/organizationModel.js";
import Appointment from "../models/appointmentModel.js";

// Umbrales de elegibilidad (espejo del script de diagnóstico)
const MIN_AGE_DAYS = 45; // antigüedad mínima de la org para un "antes/después" creíble
const MIN_PAST_APPTS = 20; // volumen mínimo de citas pasadas
// El bloque de ausencias requiere no_show ESPECÍFICAMENTE (no basta "resuelto"):
const MIN_NOSHOW_COUNT = 3;
const MIN_NOSHOW_RATIO = 5; // % de no_show sobre lo resuelto (attended + no_show)

const CANCELLED_STATUSES = ["cancelled", "cancelled_by_customer", "cancelled_by_admin"];

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

/** Fecha de registro con fallback al timestamp del ObjectId (orgs legacy sin createdAt). */
function regDateOf(org) {
  return org.createdAt || org._id.getTimestamp();
}

/** Resumen por org de citas pasadas, en una sola agregación. */
function summaryByOrg(now, organizationId) {
  const match = { startDate: { $lt: now } };
  if (organizationId) match.organizationId = organizationId;
  return Appointment.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$organizationId",
        total: { $sum: 1 },
        noShow: { $sum: { $cond: [{ $eq: ["$status", "no_show"] }, 1, 0] } },
        attended: { $sum: { $cond: [{ $eq: ["$status", "attended"] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $in: ["$status", CANCELLED_STATUSES] }, 1, 0] } },
        online: { $sum: { $cond: [{ $ne: ["$reservationId", null] }, 1, 0] } },
      },
    },
  ]);
}

/** Citas pasadas por org y mes (de startDate), para la tendencia. */
function monthlyByOrg(now, organizationId) {
  const match = { startDate: { $lt: now } };
  if (organizationId) match.organizationId = organizationId;
  return Appointment.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          org: "$organizationId",
          ym: { $dateToString: { format: "%Y-%m", date: "$startDate" } },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.ym": 1 } },
  ]);
}

/** Arma el objeto de reporte a partir del resumen y la serie mensual de una org. */
function buildReport(org, summary, months, now) {
  const regDate = regDateOf(org);
  const daysActive = Math.floor((now - regDate) / 86400000);

  const total = summary?.total || 0;
  const noShowCount = summary?.noShow || 0;
  const attended = summary?.attended || 0;
  const resolved = attended + noShowCount;
  const noShowRate = pct(noShowCount, resolved); // ausencias sobre lo resuelto
  const onlineCount = summary?.online || 0;
  const cancelledCount = summary?.cancelled || 0;

  const byMonth = (months || []).map((m) => ({ month: m.ym, count: m.count }));
  const peakMonth = byMonth.reduce(
    (mx, m) => (m.count > (mx?.count || 0) ? m : mx),
    null
  );
  const monthsActive = byMonth.length || 1;
  const avgPerMonth = Math.round(total / monthsActive);

  const eligible = daysActive >= MIN_AGE_DAYS && total >= MIN_PAST_APPTS;
  const noShowApplicable =
    noShowCount >= MIN_NOSHOW_COUNT && noShowRate >= MIN_NOSHOW_RATIO;

  return {
    org: {
      id: String(org._id),
      name: org.name || "—",
      businessVertical: org.businessVertical || null,
      registeredAt: regDate,
      daysActive,
    },
    eligible,
    appointments: {
      total,
      avgPerMonth,
      peakMonth: peakMonth ? { month: peakMonth.month, count: peakMonth.count } : null,
      byMonth,
    },
    onlineReservations: {
      count: onlineCount,
      pct: pct(onlineCount, total),
    },
    cancellations: {
      count: cancelledCount,
      pct: pct(cancelledCount, total),
    },
    // Bloque opcional: solo confiable cuando `applicable` es true.
    noShow: {
      applicable: noShowApplicable,
      count: noShowCount,
      rate: noShowRate,
    },
  };
}

/**
 * Lista los reportes de impacto de las organizaciones (preview superadmin).
 * Por defecto solo devuelve las elegibles (antigüedad + volumen suficientes).
 *
 * @param {{ includeIneligible?: boolean }} opts
 */
export async function listImpactReports({ includeIneligible = false } = {}) {
  const now = new Date();
  const [summaries, months, orgs] = await Promise.all([
    summaryByOrg(now),
    monthlyByOrg(now),
    Organization.find({}).select("name createdAt businessVertical").lean(),
  ]);

  const summaryMap = new Map(summaries.map((s) => [String(s._id), s]));
  const monthsMap = new Map();
  for (const m of months) {
    const key = String(m._id.org);
    if (!monthsMap.has(key)) monthsMap.set(key, []);
    monthsMap.get(key).push({ ym: m._id.ym, count: m.count });
  }

  const all = orgs
    .map((org) =>
      buildReport(org, summaryMap.get(String(org._id)), monthsMap.get(String(org._id)), now)
    )
    .filter((r) => r.appointments.total > 0);

  const eligible = all.filter((r) => r.eligible);
  const result = (includeIneligible ? all : eligible).sort(
    (a, b) => b.appointments.total - a.appointments.total
  );

  return {
    generatedAt: now,
    thresholds: { minAgeDays: MIN_AGE_DAYS, minPastAppts: MIN_PAST_APPTS },
    counts: {
      withAppointments: all.length,
      eligible: eligible.length,
      withNoShowBlock: eligible.filter((r) => r.noShow.applicable).length,
      withOnline: eligible.filter((r) => r.onlineReservations.count > 0).length,
    },
    reports: result,
  };
}

/**
 * Reporte de impacto de UNA organización. Listo para el flujo cara-al-cliente
 * (fase 3). Devuelve null si la org no existe.
 *
 * @param {string} organizationId
 */
export async function computeOrgImpactReport(organizationId) {
  const now = new Date();
  const org = await Organization.findById(organizationId)
    .select("name createdAt businessVertical")
    .lean();
  if (!org) return null;

  const [summaries, months] = await Promise.all([
    summaryByOrg(now, organizationId),
    monthlyByOrg(now, organizationId),
  ]);

  return buildReport(
    org,
    summaries[0],
    months.map((m) => ({ ym: m._id.ym, count: m.count })),
    now
  );
}
