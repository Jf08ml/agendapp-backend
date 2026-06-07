/**
 * platformAnalyticsService.js
 *
 * Métricas globales de la plataforma para el dashboard de analítica del superadmin.
 * A diferencia de appointmentService.getAppointmentsAggregatedByRange (acotado a una org
 * y su timezone), estas agregaciones son cross-organization y se calculan en UTC.
 */

import Organization from "../models/organizationModel.js";
import Appointment from "../models/appointmentModel.js";
import Reservation from "../models/reservationModel.js";
import Membership from "../models/membershipModel.js";

const CANCELLED_STATUSES = ["cancelled", "cancelled_by_customer", "cancelled_by_admin"];

/** Meses equivalentes por ciclo de facturación, para normalizar a MRR (lifetime se excluye por ser pago único) */
const BILLING_CYCLE_MONTHS = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  yearly: 12,
};

function toDateRange(startDate, endDate) {
  return {
    start: new Date(`${startDate}T00:00:00.000Z`),
    end: new Date(`${endDate}T23:59:59.999Z`),
  };
}

/**
 * Snapshot de KPIs globales para el rango de fechas dado.
 */
export async function getPlatformOverview({ startDate, endDate }) {
  const { start, end } = toDateRange(startDate, endDate);

  const [
    newOrganizations,
    appointmentStats,
    reservationsCount,
    membershipBreakdownRaw,
    trialToActiveConversions,
    mrrRaw,
  ] = await Promise.all([
    Organization.countDocuments({ createdAt: { $gte: start, $lte: end } }),

    Appointment.aggregate([
      { $match: { startDate: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          ingresos: { $sum: { $ifNull: ["$totalPrice", 0] } },
          atendidas: { $sum: { $cond: [{ $eq: ["$status", "attended"] }, 1, 0] } },
          canceladas: { $sum: { $cond: [{ $in: ["$status", CANCELLED_STATUSES] }, 1, 0] } },
          noShows: { $sum: { $cond: [{ $eq: ["$status", "no_show"] }, 1, 0] } },
        },
      },
    ]),

    Reservation.countDocuments({ createdAt: { $gte: start, $lte: end } }),

    Membership.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),

    // Aproximación: membresías que pasaron a "active" dentro del rango (asume origen en trial)
    Membership.countDocuments({ status: "active", startDate: { $gte: start, $lte: end } }),

    Membership.aggregate([
      { $match: { status: "active" } },
      {
        $lookup: {
          from: "plans",
          localField: "planId",
          foreignField: "_id",
          as: "plan",
        },
      },
      { $unwind: "$plan" },
      { $match: { "plan.billingCycle": { $in: Object.keys(BILLING_CYCLE_MONTHS) } } },
      {
        $project: {
          monthlyEquivalent: {
            $divide: [
              "$plan.price",
              {
                $switch: {
                  branches: Object.entries(BILLING_CYCLE_MONTHS).map(([cycle, months]) => ({
                    case: { $eq: ["$plan.billingCycle", cycle] },
                    then: months,
                  })),
                  default: 1,
                },
              },
            ],
          },
        },
      },
      { $group: { _id: null, mrr: { $sum: "$monthlyEquivalent" } } },
    ]),
  ]);

  const stats = appointmentStats[0] || { total: 0, ingresos: 0, atendidas: 0, canceladas: 0, noShows: 0 };

  const membershipBreakdown = membershipBreakdownRaw.reduce((acc, { _id, count }) => {
    acc[_id] = count;
    return acc;
  }, {});

  return {
    newOrganizations,
    appointments: {
      total: stats.total,
      ingresos: stats.ingresos,
      atendidas: stats.atendidas,
      canceladas: stats.canceladas,
      noShows: stats.noShows,
    },
    reservations: reservationsCount,
    membershipBreakdown,
    trialToActiveConversions,
    mrr: mrrRaw[0]?.mrr || 0,
  };
}

/**
 * Serie temporal global (nuevas orgs, citas, cancelaciones, ingresos) por bucket de tiempo.
 * Granularidad: day | week | month — agrupación en UTC.
 */
export async function getPlatformTimeSeries({ startDate, endDate, granularity = "day" }) {
  const { start, end } = toDateRange(startDate, endDate);

  let format = "%Y-%m-%d";
  if (granularity === "week") format = "%Y-%U";
  if (granularity === "month") format = "%Y-%m";

  const [orgBuckets, appointmentBuckets] = await Promise.all([
    Organization.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: { $dateToString: { format, date: "$createdAt" } },
          newOrgs: { $sum: 1 },
          firstDate: { $min: "$createdAt" },
        },
      },
    ]),

    Appointment.aggregate([
      { $match: { startDate: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: { $dateToString: { format, date: "$startDate" } },
          citas: { $sum: 1 },
          ingresos: { $sum: { $ifNull: ["$totalPrice", 0] } },
          cancelaciones: { $sum: { $cond: [{ $in: ["$status", CANCELLED_STATUSES] }, 1, 0] } },
          firstDate: { $min: "$startDate" },
        },
      },
    ]),
  ]);

  // Combinar ambas series por clave de bucket
  const merged = new Map();
  for (const b of orgBuckets) {
    merged.set(b._id, { key: b._id, timestamp: new Date(b.firstDate).getTime(), newOrgs: b.newOrgs, citas: 0, ingresos: 0, cancelaciones: 0 });
  }
  for (const b of appointmentBuckets) {
    const existing = merged.get(b._id);
    if (existing) {
      existing.citas = b.citas;
      existing.ingresos = b.ingresos;
      existing.cancelaciones = b.cancelaciones;
    } else {
      merged.set(b._id, {
        key: b._id,
        timestamp: new Date(b.firstDate).getTime(),
        newOrgs: 0,
        citas: b.citas,
        ingresos: b.ingresos,
        cancelaciones: b.cancelaciones,
      });
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Ranking de organizaciones por actividad (citas o ingresos) en el rango dado.
 */
export async function getOrganizationRanking({ startDate, endDate, sortBy = "citas", limit = 10 }) {
  const { start, end } = toDateRange(startDate, endDate);
  const sortField = sortBy === "ingresos" ? "ingresos" : "citas";

  const ranking = await Appointment.aggregate([
    { $match: { startDate: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: "$organizationId",
        citas: { $sum: 1 },
        ingresos: { $sum: { $ifNull: ["$totalPrice", 0] } },
        lastActivity: { $max: "$updatedAt" },
      },
    },
    { $sort: { [sortField]: -1 } },
    { $limit: Math.min(Number(limit) || 10, 50) },
    {
      $lookup: {
        from: "organizations",
        localField: "_id",
        foreignField: "_id",
        as: "organization",
      },
    },
    { $unwind: "$organization" },
    {
      $lookup: {
        from: "memberships",
        localField: "_id",
        foreignField: "organizationId",
        as: "membership",
      },
    },
    {
      $project: {
        _id: 0,
        organizationId: "$_id",
        name: "$organization.name",
        slug: "$organization.slug",
        citas: 1,
        ingresos: 1,
        lastActivity: 1,
        membershipStatus: { $arrayElemAt: ["$membership.status", 0] },
      },
    },
  ]);

  return ranking;
}

export default { getPlatformOverview, getPlatformTimeSeries, getOrganizationRanking };
