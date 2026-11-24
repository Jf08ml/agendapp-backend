// Renovación del token de superadmin. El token del login lleva `adminId` y dura
// 8 h; el refresh genérico lo re-firmaba con `userId` (que no trae) y 7 días, así
// que el superadmin quedaba sin identidad y sin acceso a las rutas que exigen
// requireSuperAdmin u organizationAccess. Reglas:
//   - sin `adminId`: no se renueva (token roto de un refresh anterior);
//   - vencido: no se renueva (el superadmin vuelve a iniciar sesión);
//   - vigente: se re-firma con el mismo `adminId` y 8 h.
export const SUPERADMIN_TOKEN_TTL = "8h";
export const SUPERADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

/** Decisión pura (sin DB): { ok: true } o { ok: false, message }. */
export function superadminRefreshDecision(decoded, nowMs = Date.now()) {
  if (!decoded?.adminId) {
    return { ok: false, message: "Inicia sesión de nuevo en el panel de plataforma." };
  }
  if (!decoded.exp || decoded.exp * 1000 <= nowMs) {
    return { ok: false, message: "Tu sesión de plataforma venció. Inicia sesión de nuevo." };
  }
  return { ok: true };
}
