import AuditLog from "../models/auditLogModel.js";

/**
 * Registra una acción de eliminación en el audit log.
 * Este registro es inmutable: no hay endpoints de modificación ni eliminación.
 *
 * @param {Object} params
 * @param {string}  params.organizationId
 * @param {string}  params.action          - Ej: 'delete_appointment'
 * @param {string}  params.entityType      - 'appointment' | 'client' | 'employee' | 'reservation'
 * @param {string}  params.entityId        - ID del documento eliminado
 * @param {Object}  [params.entitySnapshot]- Campos clave del documento antes de eliminar
 * @param {string}  [params.performedById]
 * @param {string}  [params.performedByName]
 * @param {string}  [params.performedByRole]
 * @param {Object}  [params.metadata]
 */
const log = async ({
  organizationId,
  action,
  entityType,
  entityId,
  entitySnapshot = {},
  performedById = null,
  performedByName = "Sistema",
  performedByRole = null,
  metadata = {},
}) => {
  try {
    await AuditLog.create({
      organizationId,
      action,
      entityType,
      entityId: String(entityId),
      entitySnapshot,
      performedById,
      performedByName,
      performedByRole,
      metadata,
    });
  } catch (err) {
    // El error de auditoría no debe interrumpir la operación principal
    console.error("[AuditLog] Error al registrar:", err.message);
  }
};

/**
 * Construye el snapshot de una cita para el log.
 */
const snapshotAppointment = (apt) => ({
  clientName: apt.client?.name || apt.client || null,
  clientPhone: apt.client?.phone_e164 || apt.client?.phoneNumber || null,
  serviceName: apt.service?.name || apt.service || null,
  employeeName: apt.employee?.names || apt.employee || null,
  startDate: apt.startDate,
  endDate: apt.endDate,
  status: apt.status,
  groupId: apt.groupId || null,
});

/**
 * Construye el snapshot de un cliente para el log.
 */
const snapshotClient = (client) => ({
  name: client.name,
  phoneNumber: client.phoneNumber,
  phone_e164: client.phone_e164 || null,
  email: client.email || null,
});

/**
 * Construye el snapshot de un empleado para el log.
 */
const snapshotEmployee = (employee) => ({
  names: employee.names,
  email: employee.email || null,
  role: employee.role || null,
  phoneNumber: employee.phoneNumber || null,
});

/**
 * Construye el snapshot de una reserva para el log.
 */
const snapshotReservation = (reservation) => ({
  customerName: reservation.customerDetails?.name || null,
  customerPhone: reservation.customerDetails?.phone || null,
  serviceName: reservation.serviceId?.name || reservation.serviceId || null,
  startDate: reservation.startDate,
  status: reservation.status,
  groupId: reservation.groupId || null,
  appointmentId: reservation.appointmentId || null,
});

export const auditLogService = {
  log,
  snapshotAppointment,
  snapshotClient,
  snapshotEmployee,
  snapshotReservation,
};
