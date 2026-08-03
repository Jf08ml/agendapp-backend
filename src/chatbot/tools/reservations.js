import Reservation from "../../models/reservationModel.js";
import reservationService from "../../services/reservationService.js";
import moment from "moment-timezone";

const formatDate = (date, tz) => moment(date).tz(tz).format("DD/MM/YYYY [a las] HH:mm");

// Aprueba/rechaza siguiendo exactamente el mismo patrón que ReservationsList.tsx
// (frontend): reservationService.updateReservation(id, { status, skipNotification, forceApprove }).
// Para grupos, solo la ÚLTIMA reserva pendiente del grupo dispara el WhatsApp
// (igual que handleApproveGroup en el frontend).
async function approveOne(reservation, { skipNotification = false, forceApprove = false } = {}) {
  return reservationService.updateReservation(reservation._id.toString(), {
    status: "approved",
    skipNotification,
    forceApprove,
  });
}

export default [
  {
    name: "get_pending_reservations",
    description:
      "Lista las reservas online pendientes de revisión (esperando aprobación manual del negocio). Úsala cuando el usuario pregunte por reservas pendientes, solicitudes nuevas o qué hay para aprobar.",
    parameters: {
      limit: { type: "number", description: "Máximo de reservas a devolver (por defecto 20).", required: false },
    },
    handler: async (params, context) => {
      const tz = context.organization.timezone || "America/Bogota";
      const reservations = await Reservation.find({
        organizationId: context.organizationId,
        status: "pending",
      })
        .populate("serviceId", "name")
        .populate("employeeId", "names")
        .sort({ startDate: 1 })
        .limit(params.limit || 20);

      if (reservations.length === 0) {
        return { success: true, found: false, message: "No hay reservas pendientes por revisar." };
      }

      return {
        success: true,
        total: reservations.length,
        reservas: reservations.map((r) => ({
          id: r._id.toString(),
          cliente: r.customerDetails?.name || "?",
          telefono: r.customerDetails?.phone || null,
          servicio: r.serviceId?.name || "?",
          profesional: r.employeeId?.names || "Sin preferencia",
          fecha: formatDate(r.startDate, tz),
          grupoId: r.groupId ? r.groupId.toString() : null,
        })),
      };
    },
  },
  {
    name: "approve_reservation",
    description:
      "Aprueba una reserva online pendiente (crea la cita real en la agenda). Si la reserva pertenece a un grupo (varias reservas de la misma solicitud), aprueba TODO el grupo junto — así funciona también en la interfaz. Si la reserva no tenía profesional asignado y el usuario ya indicó cuál usar, pasa employeeId para asignarlo antes de aprobar. Si la tool devuelve concurrencyConflict: true, informa el conflicto al usuario y solo reintenta con force: true si el usuario confirma explícitamente que quiere aprobar igual.",
    parameters: {
      reservationId: { type: "string", description: "ID de la reserva a aprobar (obtenido de get_pending_reservations).", required: true },
      employeeId: { type: "string", description: "ID del profesional a asignar antes de aprobar, si la reserva no tenía uno y el usuario lo indicó ahora.", required: false },
      force: { type: "boolean", description: "Aprobar aunque haya un conflicto de disponibilidad. Úsalo SOLO tras confirmación explícita del usuario sobre un concurrencyConflict previo.", required: false },
    },
    handler: async (params, context) => {
      const reservation = await Reservation.findOne({ _id: params.reservationId, organizationId: context.organizationId })
        .populate("serviceId", "name")
        .populate("employeeId", "names");
      if (!reservation) return { success: false, error: "No se encontró esa reserva." };
      if (reservation.status !== "pending") {
        return { success: false, error: `Esa reserva ya no está pendiente (estado actual: ${reservation.status}).` };
      }

      if (params.employeeId) {
        await reservationService.updateReservation(reservation._id.toString(), { employeeId: params.employeeId });
      }

      try {
        if (reservation.groupId) {
          const group = await Reservation.find({ groupId: reservation.groupId, status: "pending" }).sort({ startDate: 1 });
          for (let i = 0; i < group.length; i++) {
            await approveOne(group[i], { skipNotification: i < group.length - 1, forceApprove: !!params.force });
          }
          return { success: true, approved: "group", count: group.length, message: `Se aprobaron ${group.length} reserva(s) del mismo grupo y se crearon sus citas.` };
        }

        await approveOne(reservation, { forceApprove: !!params.force });
        return {
          success: true,
          approved: "single",
          resumen: `${reservation.serviceId?.name || "Servicio"} de ${reservation.customerDetails?.name || "?"}`,
        };
      } catch (err) {
        if (err.code === "CONCURRENCY_LIMIT_REACHED") {
          return {
            success: false,
            concurrencyConflict: true,
            message: `No hay disponibilidad en ese horario (límite de citas simultáneas alcanzado). ${err.message}`,
            _instruction: "Informa el conflicto al usuario. Solo reintenta approve_reservation con force: true si el usuario confirma explícitamente que quiere aprobarla igual.",
          };
        }
        return { success: false, error: err.message };
      }
    },
  },
  {
    name: "reject_reservation",
    description:
      "Rechaza una reserva online pendiente (no crea cita). Si pertenece a un grupo, rechaza todas las reservas pendientes de ese grupo.",
    parameters: {
      reservationId: { type: "string", description: "ID de la reserva a rechazar (obtenido de get_pending_reservations).", required: true },
    },
    handler: async (params, context) => {
      const reservation = await Reservation.findOne({ _id: params.reservationId, organizationId: context.organizationId })
        .populate("serviceId", "name");
      if (!reservation) return { success: false, error: "No se encontró esa reserva." };
      if (reservation.status !== "pending") {
        return { success: false, error: `Esa reserva ya no está pendiente (estado actual: ${reservation.status}).` };
      }

      if (reservation.groupId) {
        const group = await Reservation.find({ groupId: reservation.groupId, status: "pending" });
        await Promise.all(group.map((r) => reservationService.updateReservation(r._id.toString(), { status: "rejected" })));
        return { success: true, rejected: "group", count: group.length };
      }

      await reservationService.updateReservation(reservation._id.toString(), { status: "rejected" });
      return { success: true, rejected: "single", resumen: `${reservation.serviceId?.name || "Servicio"} de ${reservation.customerDetails?.name || "?"}` };
    },
  },
];
