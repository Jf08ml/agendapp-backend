import Organization from "../models/organizationModel.js";
import Employee from "../models/employeeModel.js";

/**
 * Resuelve la organización y el nombre/rol de quien hace la request a partir
 * de req.user (que solo trae { userId, userType } — no hay organizationResolver
 * en estas rutas, mismo caso que resolveOrgId en announcementController.js).
 * Devuelve { organizationId, name, role } o null si no aplica (ej. superadmin).
 */
export async function resolveOrgContext(user) {
  if (!user) return null;

  if (user.userType === "admin") {
    const org = await Organization.findById(user.userId).select("name ownerName").lean();
    if (!org) return null;
    return {
      organizationId: org._id,
      name: org.ownerName || org.name,
      role: "admin",
    };
  }

  if (user.userType === "employee") {
    const emp = await Employee.findById(user.userId).select("organizationId names").lean();
    if (!emp?.organizationId) return null;
    return {
      organizationId: emp.organizationId,
      name: emp.names,
      role: "employee",
    };
  }

  return null;
}
