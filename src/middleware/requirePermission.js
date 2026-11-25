// Permisos del panel en el backend (roles a medida · Fase 3).
//
// Hasta ahora los permisos de los empleados (rol + customPermissions) solo
// ocultaban pantallas en el panel: con una sesión de profesional se podía
// llamar a la API de clientes o de ajustes directamente. Este middleware los
// hace cumplir en el servidor.
//
// Quién pasa:
//   - superadmin de plataforma (con adminId): siempre;
//   - dueño del negocio (userType "admin", incluida la impersonación): siempre;
//   - empleado: si su rol o sus permisos individuales incluyen ALGUNO de los
//     permisos pedidos (anyOf), y es de la organización del request.
// Se usa DESPUÉS de verifyToken (y organizationResolver cuando aplica).
import Employee from "../models/employeeModel.js";

const isSuperadmin = (user) => user?.userType === "superadmin" && !!user?.adminId;

/**
 * Decisión pura (sin DB).
 * @returns {"allow" | "deny" | "need-employee"}
 */
export function permissionDecision({ user, anyOf, employee, organizationId }) {
  if (!user) return "deny";
  if (isSuperadmin(user)) return "allow";
  if (user.userType === "admin") return "allow";
  if (user.userType !== "employee") return "deny";
  if (employee === undefined) return "need-employee";
  if (!employee || employee.isActive === false) return "deny";
  if (organizationId && String(employee.organizationId) !== String(organizationId)) return "deny";
  const perms = new Set([...(employee.role?.permissions || []), ...(employee.customPermissions || [])]);
  return anyOf.some((p) => perms.has(p)) ? "allow" : "deny";
}

/** Empleado con su rol, una sola vez por request. */
async function loadEmployee(req) {
  if (req._employeeForPerms !== undefined) return req._employeeForPerms;
  req._employeeForPerms = await Employee.findById(req.user.userId)
    .select("organizationId role customPermissions isActive")
    .populate("role", "permissions")
    .lean();
  return req._employeeForPerms;
}

/**
 * @param {string[]} anyOf  pasa con cualquiera de estos permisos
 */
export function requirePermission(...anyOf) {
  return async (req, res, next) => {
    try {
      const organizationId = req.organization?._id;
      let decision = permissionDecision({ user: req.user, anyOf, organizationId });
      if (decision === "need-employee") {
        decision = permissionDecision({ user: req.user, anyOf, employee: await loadEmployee(req), organizationId });
      }
      if (decision !== "allow") {
        return res.status(403).json({ result: "error", message: "No tienes permiso para esta acción." });
      }
      next();
    } catch (error) {
      console.error("[requirePermission]", error);
      return res.status(500).json({ result: "error", message: "No se pudo verificar el permiso" });
    }
  };
}

// Grupos usados por las rutas (los nombres son los de Role.permissions).
export const PERMS = {
  // Ajustes del negocio: lo guardan Ajustes, Clases, la tienda de Inventario,
  // WhatsApp y Reservas online; todos esos permisos son de administración.
  businessSettings: [
    "businessInformation:read",
    "services:read",
    "services:update",
    "inventory:manage",
    "whatsapp:read",
    "reservationOnline:read",
  ],
  whatsapp: ["whatsapp:read"],
  // Clientes: la agenda los busca y crea al agendar.
  clientsRead: ["clients:read", "appointments:create", "appointments:update", "appointments:view_all"],
  clientsCreate: ["clients:create", "appointments:create"],
  clientsUpdate: ["clients:update"],
  clientsDelete: ["clients:delete"],
  clientsLoyalty: ["clients:add_service", "clients:add_referral", "clients:update"],
  // Sellar la tarjeta (servicio o referido) al escanearla: como hoy, cualquier
  // persona del equipo con sesión (todos los roles tienen appointments:view_own).
  loyaltyStamp: ["clients:add_service", "clients:add_referral", "clients:update", "appointments:view_own"],
  // Caja: gastos e ingresos generales del negocio (pantalla Caja).
  cash: ["cashManagement:read"],
  // Anticipos e ingresos de un profesional: los registra Profesionales o la
  // nómina de Caja (ambas piden employees:read en el panel).
  advancesWrite: ["employees:add_advance", "employees:update", "employees:read"],
  // Ver los de OTRO profesional; los propios los ve cualquiera del equipo
  // (Mi información). Ver advanceRoutes.
  advancesReadOthers: ["employees:read", "employees:view_payroll", "employees:add_advance", "cashManagement:read"],
};

/**
 * GET /advances/employee/:employeeId: cada profesional ve los suyos; los de
 * otro, solo con permiso de Profesionales o Caja.
 */
export function requireOwnOrPermission(paramName, anyOf) {
  const check = requirePermission(...anyOf);
  return (req, res, next) => {
    if (req.user?.userType === "employee" && String(req.params[paramName]) === String(req.user.userId)) {
      return next();
    }
    return check(req, res, next);
  };
}
