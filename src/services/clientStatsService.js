// Cifras por cliente para Clientes (design system, ClientesPanel · Fase 3):
// última visita, visitas, total gastado y si tiene un paquete activo. Con eso
// el panel arma los segmentos (Frecuentes, Inactivos +60 días, Con paquete).
//
// «Visita» = cita ya pasada que no se canceló ni quedó como «no asistió»
// (muchos negocios no marcan «asistió», así que no se exige).
import Appointment from "../models/appointmentModel.js";
import ClientPackage from "../models/clientPackageModel.js";

const NOT_A_VISIT = ["cancelled", "cancelled_by_customer", "cancelled_by_admin", "no_show"];

/**
 * Filas de la agregación + clientes con paquete → mapa por cliente. (puro)
 * @param {Array<{ _id, lastVisit, visits, totalSpent }>} rows
 * @param {Array} activePackageClientIds
 */
export function buildClientStats(rows, activePackageClientIds = []) {
  const stats = {};
  for (const r of rows) {
    if (!r._id) continue;
    stats[String(r._id)] = {
      lastVisit: r.lastVisit ? new Date(r.lastVisit).toISOString() : null,
      visits: r.visits || 0,
      totalSpent: Math.round((Number(r.totalSpent) || 0) * 100) / 100,
      activePackage: false,
    };
  }
  for (const id of activePackageClientIds) {
    const key = String(id);
    stats[key] = stats[key] || { lastVisit: null, visits: 0, totalSpent: 0, activePackage: false };
    stats[key].activePackage = true;
  }
  return stats;
}

export async function getClientStats(organizationId, now = new Date()) {
  const [rows, pkgClientIds] = await Promise.all([
    Appointment.aggregate([
      {
        $match: {
          organizationId,
          client: { $ne: null },
          startDate: { $lt: now },
          status: { $nin: NOT_A_VISIT },
        },
      },
      {
        $group: {
          _id: "$client",
          lastVisit: { $max: "$startDate" },
          visits: { $sum: 1 },
          totalSpent: { $sum: { $ifNull: ["$totalPrice", 0] } },
        },
      },
    ]),
    ClientPackage.distinct("clientId", { organizationId, status: "active", expirationDate: { $gte: now } }),
  ]);
  return buildClientStats(rows, pkgClientIds);
}

export default { getClientStats, buildClientStats };
