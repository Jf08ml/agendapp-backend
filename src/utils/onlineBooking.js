// Profesionales ocultos de la reserva en línea (Employee.onlineBookingEnabled ===
// false): siguen activos en el sistema (agenda interna, citas que crea el admin,
// reportes) pero no se ofrecen en el wizard público, ni en el asistente de
// reservas web/WhatsApp, ni se auto-asignan a reservas públicas.
import Employee from "../models/employeeModel.js";

// Filtro Mongo para combinar con las consultas de profesionales elegibles.
// $ne:false (no ===true) para que los empleados sin el campo cuenten como visibles.
export const ONLINE_BOOKABLE_EMPLOYEE = { onlineBookingEnabled: { $ne: false } };

// Profesionales de respaldo (Employee.onlineBookingBackup === true): entran en
// la auto-asignación, pero solo en los horarios en que los demás profesionales
// del servicio están ocupados (scheduleService.findOnlineBookingBlocks).
// No se ofrecen para elegir: el cliente que pide uno por nombre queda "sin
// preferencia" — si no, se saltaría la prioridad del profesional principal.
export const ONLINE_SELECTABLE_EMPLOYEE = {
  ...ONLINE_BOOKABLE_EMPLOYEE,
  onlineBookingBackup: { $ne: true },
};

/**
 * Si alguno de los servicios de una reserva pública trae un profesional oculto
 * de la reserva en línea, devuelve el mensaje de error para el cliente; si no, null.
 * @param {Array<{employeeId?: string|object}>} services
 */
export async function onlineBookingEmployeeError(services, organizationId) {
  const ids = [
    ...new Set(
      (services || [])
        .map((s) => (typeof s.employeeId === "object" && s.employeeId ? s.employeeId._id : s.employeeId))
        .filter(Boolean)
        .map(String)
    ),
  ];
  if (!ids.length) return null;
  const hidden = await Employee.findOne({
    _id: { $in: ids },
    organizationId,
    onlineBookingEnabled: false,
  })
    .select("names")
    .lean();
  return hidden
    ? `${hidden.names} no está disponible para reservas en línea. Elige otro profesional o comunícate con el negocio.`
    : null;
}
