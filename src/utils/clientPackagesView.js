// «Mis paquetes» en Mis reservas (design system, MisReservas · Fase 3): los
// paquetes del cliente con lo que le queda de cada servicio o clase. Solo con
// el enlace personal (no en la consulta por teléfono). Puro para `node --test`.

const ENDED_VISIBLE_DAYS = 30;

/** ¿Se muestra? Activos siempre; vencidos o agotados, 30 días después. */
export function isPackageVisible(pkg, now = new Date()) {
  if (pkg.status === "cancelled") return false;
  if (pkg.status === "active" && new Date(pkg.expirationDate) >= now) return true;
  const endedAt = pkg.status === "exhausted" ? new Date(pkg.updatedAt || pkg.expirationDate) : new Date(pkg.expirationDate);
  return now.getTime() - endedAt.getTime() <= ENDED_VISIBLE_DAYS * 86400000;
}

/** Estado en palabras: activo, vence pronto (≤ 7 días), agotado o vencido. */
export function packageState(pkg, now = new Date()) {
  if (pkg.status === "exhausted") return "exhausted";
  const exp = new Date(pkg.expirationDate);
  if (pkg.status === "expired" || exp < now) return "expired";
  return exp.getTime() - now.getTime() <= 7 * 86400000 ? "expiring" : "active";
}

const item = (row, nameField) => ({
  name: row?.[nameField]?.name || (nameField === "classId" ? "Clase" : "Servicio"),
  remaining: Math.max(0, Number(row.sessionsRemaining) || 0),
  total: Math.max(0, Number(row.sessionsIncluded) || 0),
});

/** Paquete (con servicePackageId, services.serviceId y classes.classId populados) → vista. */
export function packageView(pkg, now = new Date()) {
  return {
    id: String(pkg._id),
    name: pkg.servicePackageId?.name || "Paquete",
    tierLabel: pkg.tierLabel || null,
    purchaseDate: pkg.purchaseDate,
    expirationDate: pkg.expirationDate,
    state: packageState(pkg, now),
    items: [...(pkg.services || []).map((s) => item(s, "serviceId")), ...(pkg.classes || []).map((c) => item(c, "classId"))],
  };
}

/** Orden: activos que vencen antes primero; después los terminados. */
export function sortPackages(views) {
  const rank = { expiring: 0, active: 1, exhausted: 2, expired: 3 };
  return [...views].sort(
    (a, b) => rank[a.state] - rank[b.state] || new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime()
  );
}
