// Acceso a /api/services con sesión (crear, ver, editar, borrar, listar).
// Antes bastaba cualquier sesión: se podía ver, editar o borrar un servicio de
// otro negocio por su id, crear servicios en otro negocio (organizationId del
// body) y GET /api/services listaba los servicios de todos los negocios.
// Ahora cada usuario solo toca los servicios de su negocio; el superadmin, todos.
// Reglas puras (sin DB) para `node --test`.

const isSuperadmin = (user) => user?.userType === "superadmin" && !!user?.adminId;

/** ¿Puede este usuario ver o cambiar un servicio de `serviceOrgId`? */
export function canAccessService({ user, userOrgId, serviceOrgId }) {
  if (!user) return false;
  if (isSuperadmin(user)) return true;
  return !!userOrgId && !!serviceOrgId && String(userOrgId) === String(serviceOrgId);
}

/**
 * Qué devuelve GET /api/services: superadmin → todos ({ all: true });
 * los demás → solo su negocio ({ orgId }); sin negocio → { deny: true }.
 */
export function listScope({ user, userOrgId }) {
  if (isSuperadmin(user)) return { all: true };
  return userOrgId ? { orgId: String(userOrgId) } : { deny: true };
}

/** Campos que no se pueden cambiar al editar un servicio. */
export function editableServiceFields(body = {}) {
  const { _id, organizationId, createdAt, updatedAt, __v, ...rest } = body; // eslint-disable-line no-unused-vars
  return rest;
}
