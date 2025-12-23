import mongoose from "mongoose";
import serviceModel from "../models/serviceModel.js";
import notificationService from "../services/notificationService.js";
import organizationService from "../services/organizationService.js";
import reservationService from "../services/reservationService.js";
import appointmentService from "../services/appointmentService.js";
import subscriptionService from "../services/subscriptionService.js";
import sendResponse from "../utils/sendResponse.js";
import employeeService from "../services/employeeService.js";
import scheduleService from "../services/scheduleService.js";
import employeeModel from "../models/employeeModel.js";

// ---------------------- helpers de notificación ----------------------
async function notifyNewBooking(org, customerDetails, { isAuto, multi }) {
  const title = isAuto
    ? "Nueva cita automática"
    : multi
    ? "Nueva reserva múltiple"
    : "Nueva reserva";

  const message = isAuto
    ? `Se crearon citas automáticas para ${customerDetails.name}`
    : multi
    ? `Tienes nuevas reservas de ${customerDetails.name}`
    : `Tienes una nueva reserva pendiente por confirmar de ${customerDetails.name}`;

  try {
    await notificationService.createNotification({
      title,
      message,
      organizationId: org._id,
      type: "reservation",
      frontendRoute: isAuto ? `/agenda` : `/gestionar-reservas-online`,
      status: "unread",
    });

    await subscriptionService.sendNotificationToUser(
      org._id,
      JSON.stringify({
        title,
        message,
        icon: org?.branding?.pwaIcon,
      })
    );
  } catch (e) {
    console.warn(
      "[notifyNewBooking] Error enviando notificaciones:",
      e?.message || e
    );
  }
}

const reservationController = {
  // Crear una nueva reserva (single)
  createReservation: async (req, res) => {
    const {
      serviceId,
      employeeId,
      startDate,
      customerDetails,
      organizationId,
    } = req.body;

    try {
      // Org y política
      const org = await organizationService.getOrganizationById(organizationId);
      if (!org)
        return sendResponse(res, 404, null, "Organización no encontrada");
      const policy = org.reservationPolicy || "manual";

      // 🕒 VALIDAR HORARIO DE DISPONIBILIDAD
      const requestedDateTime = new Date(startDate);
      
      // Validar empleado si fue especificado
      let employee = null;
      if (employeeId) {
        employee = await employeeModel.findById(employeeId);
        if (!employee) {
          return sendResponse(res, 404, null, "Empleado no encontrado");
        }
      }

      // Validar que la fecha/hora esté dentro de los horarios permitidos
      const scheduleValidation = scheduleService.validateDateTime(
        requestedDateTime,
        org,
        employee
      );

      if (!scheduleValidation.valid) {
        return sendResponse(res, 400, null, scheduleValidation.reason);
      }

      // ✅ VALIDAR DISPONIBILIDAD DEL SLOT (evitar race conditions)
      if (employee) {
        const service = await serviceModel.findById(serviceId);
        if (!service) {
          return sendResponse(res, 404, null, "Servicio no encontrado");
        }

        // Obtener citas del día
        const startOfDay = new Date(requestedDateTime);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(requestedDateTime);
        endOfDay.setHours(23, 59, 59, 999);

        const dayAppointments = await appointmentService.getAppointmentsByOrganizationWithDates(
          organizationId,
          startOfDay.toISOString(),
          endOfDay.toISOString(),
          [employeeId]
        );

        // Generar slots disponibles
        const availableSlots = scheduleService.generateAvailableSlots(
          requestedDateTime,
          org,
          employee,
          service.duration,
          dayAppointments
        );

        const requestedTime = `${String(requestedDateTime.getHours()).padStart(2, '0')}:${String(requestedDateTime.getMinutes()).padStart(2, '0')}`;
        const slotAvailable = availableSlots.find(s => s.time === requestedTime && s.available);

        if (!slotAvailable) {
          return sendResponse(res, 409, null, "El horario seleccionado ya no está disponible");
        }
      }

      // Cliente (asegurar)
      const customer = await reservationService.ensureClientExists({
        name: customerDetails.name,
        phoneNumber: customerDetails.phone,
        email: customerDetails.email,
        organizationId,
        birthDate: customerDetails.birthDate,
      });

      // === AUTO: intentar crear cita batch con un solo servicio
      if (policy === "auto_if_available") {
        if (employeeId) {
          try {
            const appointments =
              await appointmentService.createAppointmentsBatch({
                services: [serviceId],
                employee: employeeId,
                employeeRequestedByClient: true,
                client: customer._id,
                startDate,
                organizationId,
              });

            await notifyNewBooking(org, customerDetails, {
              isAuto: true,
              multi: false,
            });
            return sendResponse(
              res,
              201,
              { policy, outcome: "approved_and_appointed", appointments },
              "Cita creada automáticamente"
            );
          } catch (e) {
            // cae a reserva pending si no hay disponibilidad o falla
          }
        }
        // Sin empleado o fallo al auto-agendar → reserva pending
      }

      // === MANUAL (o AUTO que cayó) → crear reserva pendiente
      const newReservation = await reservationService.createReservation({
        serviceId,
        employeeId: employeeId || null,
        startDate,
        customer: customer._id,
        customerDetails,
        organizationId,
        status: "pending",
      });

      await notifyNewBooking(org, customerDetails, {
        isAuto: false,
        multi: false,
      });

      return sendResponse(
        res,
        201,
        { policy, outcome: "pending", reservation: newReservation },
        "Reserva creada exitosamente"
      );
    } catch (error) {
      return sendResponse(
        res,
        500,
        null,
        `Error al crear la reserva: ${error.message}`
      );
    }
  },

  // POST /api/reservations/multi
  createMultipleReservations: async (req, res) => {
    const { services, startDate, customerDetails, organizationId } = req.body;

    if (!services || !Array.isArray(services) || services.length === 0) {
      return sendResponse(res, 400, null, "Debe enviar al menos un servicio.");
    }
    if (
      !startDate ||
      !customerDetails?.name ||
      !customerDetails?.phone ||
      !organizationId
    ) {
      return sendResponse(
        res,
        400,
        null,
        "Datos incompletos para crear reservas."
      );
    }

    try {
      // Org y política
      const org = await organizationService.getOrganizationById(organizationId);
      if (!org)
        return sendResponse(res, 404, null, "Organización no encontrada");
      const policy = org.reservationPolicy || "manual";

      // Cliente (asegurar)
      const customer = await reservationService.ensureClientExists({
        name: customerDetails.name,
        phoneNumber: customerDetails.phone,
        email: customerDetails.email,
        organizationId,
        birthDate: customerDetails.birthDate,
      });

      // === AUTO: crear citas batch (una sola transacción/mensaje)
      const normalizeId = (v) =>
        typeof v === "object" && v !== null ? v._id?.toString() : v?.toString();

      // === AUTO: crear citas batch por empleado (grupos contiguos) y reservas auto-aprobadas
      if (policy === "auto_if_available") {
        try {
          // 1) Validaciones mínimas
          if (!Array.isArray(services) || services.length === 0) {
            return sendResponse(
              res,
              400,
              null,
              "Debe enviar al menos un servicio."
            );
          }
          // Cada item debe traer employeeId para poder agendar de una vez
          if (services.some((s) => !s.employeeId)) {
            // Puedes elegir: (a) caer a pending, (b) error 400. Aquí aviso claro:
            return sendResponse(
              res,
              400,
              null,
              "Para auto-reserva, cada servicio debe tener un empleado asignado."
            );
          }

          // 2) Normalizar duraciones y calcular startDate encadenado por servicio
          let cursor = new Date(startDate);
          const normalized = [];
          for (const item of services) {
            let duration = item.duration;
            if (!duration) {
              const svcObj = await serviceModel.findById(item.serviceId);
              if (!svcObj) throw new Error("Servicio no encontrado");
              duration = Number(svcObj.duration || 0);
            }
            const itemStart = new Date(cursor);
            cursor.setMinutes(cursor.getMinutes() + duration);

            normalized.push({
              serviceId: item.serviceId,
              employeeId: normalizeId(item.employeeId),
              startDate: itemStart,
              duration,
            });
          }

          // 3) Agrupar por empleado **respetando segmentos contiguos**
          //    createAppointmentsBatch usa un solo employee por llamada
          const groups = []; // [{ employeeId, services: [serviceId...], startDate, indices: [i...] }]
          let currentGroup = null;

          for (let i = 0; i < normalized.length; i++) {
            const n = normalized[i];
            if (!currentGroup || currentGroup.employeeId !== n.employeeId) {
              // abrir grupo nuevo
              currentGroup = {
                employeeId: n.employeeId,
                services: [],
                startDate: n.startDate, // el primer startDate del grupo
                indices: [], // para mapear luego
              };
              groups.push(currentGroup);
            }
            currentGroup.services.push(n.serviceId);
            currentGroup.indices.push(i);
          }

          // 4) Crear citas por grupo (una llamada por empleado/segmento)
          const allAppointments = new Array(normalized.length); // mapear por índice original
          for (const g of groups) {
            const batch = await appointmentService.createAppointmentsBatch({
              services: g.services,
              employee: g.employeeId,
              employeeRequestedByClient: true,
              client: normalizeId(customer),
              startDate: g.startDate, // la función encadena internamente
              organizationId: normalizeId(organizationId),
              // Si manejas precios/adicionales por servicio:
              // customPrices: {...},
              // additionalItemsByService: {...},
            });

            // Mapear las citas del batch a los índices originales de 'normalized'
            // createAppointmentsBatch devuelve en el mismo orden de 'services'
            for (let k = 0; k < g.indices.length; k++) {
              const idx = g.indices[k]; // índice original en 'normalized'
              const appt = batch[k] || null; // cita creada para ese servicio
              allAppointments[idx] = appt;
            }
          }

          // 5) Crear Reservations auto-aprobadas y (opcional) enlazar appointmentId
          const createdReservations = [];
          for (let i = 0; i < normalized.length; i++) {
            const n = normalized[i];
            const appt = allAppointments[i];

            const reservationData = {
              serviceId: n.serviceId,
              employeeId: n.employeeId,
              startDate: n.startDate,
              customer: normalizeId(customer),
              customerDetails,
              organizationId: normalizeId(organizationId),
              status: "auto_approved",
              auto: true,
              appointmentId: appt?._id || null, // ⬅️ si NO quieres vínculo aún, quita esta línea
            };

            const newReservation = await reservationService.createReservation(
              reservationData
            );
            createdReservations.push(newReservation);
          }

          await notifyNewBooking(org, customerDetails, {
            isAuto: true,
            multi: true,
          });

          return sendResponse(
            res,
            201,
            {
              policy,
              outcome: "approved_and_appointed",
              appointments: allAppointments, // útil si quieres verlas en la respuesta
              reservations: createdReservations, // para listar en tu UI
            },
            "Citas y reservas auto-aprobadas creadas correctamente"
          );
        } catch (err) {
          // Si algo falla, dejas caer al flujo MANUAL (pending) como tenías
        }
      }

      // === MANUAL (o AUTO que cayó) → crear reservas pendientes en transacción
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        let currentStart = new Date(startDate);
        const createdReservations = [];

        for (const serviceItem of services) {
          // Duración si no viene
          let duration = serviceItem.duration;
          if (!duration) {
            const serviceObj = await serviceModel
              .findById(serviceItem.serviceId)
              .session(session);
            if (!serviceObj) throw new Error("Servicio no encontrado");
            duration = serviceObj.duration;
          }

          const reservationData = {
            serviceId: serviceItem.serviceId,
            employeeId: serviceItem.employeeId || null,
            startDate: new Date(currentStart),
            customer: customer._id,
            customerDetails,
            organizationId,
            status: "pending",
          };

          const newReservation = await reservationService.createReservation(
            reservationData,
            session
          );
          createdReservations.push(newReservation);

          currentStart.setMinutes(
            currentStart.getMinutes() + Number(duration || 0)
          );
        }

        await session.commitTransaction();
        session.endSession();

        await notifyNewBooking(org, customerDetails, {
          isAuto: false,
          multi: true,
        });

        return sendResponse(
          res,
          201,
          { policy, outcome: "pending", reservations: createdReservations },
          "Reservas múltiples creadas exitosamente"
        );
      } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw error;
      }
    } catch (error) {
      return sendResponse(
        res,
        500,
        null,
        `Error al crear reservas múltiples: ${error.message}`
      );
    }
  },

  // Obtener todas las reservas de una organización
  getReservationsByOrganization: async (req, res) => {
    const { organizationId } = req.params;
    try {
      const reservations =
        await reservationService.getReservationsByOrganization(organizationId);
      sendResponse(res, 200, reservations, "Reservas obtenidas exitosamente");
    } catch (error) {
      sendResponse(
        res,
        500,
        null,
        `Error al obtener las reservas: ${error.message}`
      );
    }
  },

  // Actualizar una reserva
  updateReservation: async (req, res) => {
    const { id } = req.params;
    try {
      const updatedReservation = await reservationService.updateReservation(
        id,
        req.body
      );
      sendResponse(
        res,
        200,
        updatedReservation,
        "Reserva actualizada exitosamente"
      );
    } catch (error) {
      sendResponse(
        res,
        500,
        null,
        `Error al actualizar la reserva: ${error.message}`
      );
    }
  },

  // Eliminar una reserva
  deleteReservation: async (req, res) => {
    const { id } = req.params;
    try {
      await reservationService.deleteReservation(id);
      sendResponse(res, 200, null, "Reserva eliminada exitosamente");
    } catch (error) {
      sendResponse(
        res,
        500,
        null,
        `Error al eliminar la reserva: ${error.message}`
      );
    }
  },
};

export default reservationController;
