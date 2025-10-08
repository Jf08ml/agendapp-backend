import mongoose from "mongoose";
import serviceModel from "../models/serviceModel.js";
import notificationService from "../services/notificationService.js";
import organizationService from "../services/organizationService.js";
import reservationService from "../services/reservationService.js";
import appointmentService from "../services/appointmentService.js";
import subscriptionService from "../services/subscriptionService.js";
import sendResponse from "../utils/sendResponse.js";
import employeeService from "../services/employeeService.js";

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
      if (policy === "auto_if_available") {
        const commonEmployee = services[0]?.employeeId || null;
        const employeeData = await employeeService.getEmployeeById(commonEmployee);
        if (employeeData) {
          try {
            console.log(employeeData);
            console.log(customer)
            const createdAppointments =
              await appointmentService.createAppointmentsBatch({
                services: services.map((s) => s.serviceId),
                employee: employeeData,
                employeeRequestedByClient: true,
                client: customer,
                startDate,
                organizationId,
                // advancePayment, customPrices, additionalItemsByService: si aplica
              });

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
                appointments: createdAppointments,
              },
              "Citas creadas automáticamente"
            );
          } catch (err) {
            // cae a reservas pending si no hay disponibilidad o falla
          }
        }
        // sin empleado común → cae a reservas pending
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
