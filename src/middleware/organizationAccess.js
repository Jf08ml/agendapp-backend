// Acceso a /api/organizations/* (negocio, Meta/WhatsApp, Mercado Pago,
// sesiones). Antes bastaba cualquier sesión: el admin o un empleado de un
// negocio podía listar todos los negocios, leer/editar/borrar cualquiera por
// su id o usar el WhatsApp de otro. Ahora:
//   - superadmin: todo;
//   - rutas /:id/…: solo si :id es el negocio del usuario (admin: su userId es
//     el id del negocio; empleado: el organizationId de su ficha);
//   - listar, crear o borrar negocios: solo superadmin.
// Se usa como middleware de montaje DESPUÉS de verifyToken.
import Employee from "../models/employeeModel.js";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const isSuperadmin = (user) => user?.userType === "superadmin" && !!user?.adminId;

/**
 * Decisión pura (sin DB). `path` es la ruta relativa al montaje (/:id/…).
 * Devuelve "allow", "deny" o "need-org" (falta saber el negocio del usuario).
 */
export function organizationAccessDecision({ method, path, user, userOrgId }) {
  if (!user) return "deny";
  if (isSuperadmin(user)) return "allow";

  const [first, ...rest] = String(path || "/").split("/").filter(Boolean);

  // Raíz: listar o crear negocios (solo superadmin).
  if (!first) return "deny";
  // Rutas sin id de negocio al inicio: no existen fuera del superadmin.
  if (!OBJECT_ID.test(first)) return "deny";
  // Borrar el negocio entero: solo superadmin.
  if (rest.length === 0 && String(method).toUpperCase() === "DELETE") return "deny";

  if (userOrgId === undefined) return "need-org";
  return userOrgId && String(userOrgId) === first ? "allow" : "deny";
}

async function resolveUserOrgId(user) {
  if (user.userType === "admin") return String(user.userId);
  if (user.userType === "employee") {
    const emp = await Employee.findById(user.userId).select("organizationId").lean();
    return emp?.organizationId ? String(emp.organizationId) : null;
  }
  return null;
}

export const requireOrganizationAccess = async (req, res, next) => {
  try {
    // El mismo request pasa por varios montajes de /organizations: decidir una vez.
    if (req._orgAccess === "allow") return next();

    const base = { method: req.method, path: req.path, user: req.user };
    let decision = organizationAccessDecision(base);
    if (decision === "need-org") {
      const userOrgId = await resolveUserOrgId(req.user);
      decision = organizationAccessDecision({ ...base, userOrgId });
    }
    if (decision !== "allow") {
      return res.status(403).json({ result: "error", message: "No tienes acceso a esta organización" });
    }
    req._orgAccess = "allow";
    next();
  } catch (error) {
    console.error("[requireOrganizationAccess]", error);
    return res.status(500).json({ result: "error", message: "No se pudo verificar el acceso" });
  }
};
