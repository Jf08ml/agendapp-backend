import mongoose from "mongoose";
import serviceModel from "../models/serviceModel.js";
import notificationService from "../services/notificationService.js";
import organizationService from "../services/organizationService.js";
import reservationService from "../services/reservationService.js";
import serviceService from "../services/serviceService.js";
import subscriptionService from "../services/subscriptionService.js";
import sendResponse from "../utils/sendResponse.js";

const reservationController = {
  // Crear una nueva reserva
  createReservation: async (req, res) => {
    const {
      serviceId,
      employeeId,
      startDate,
      customerDetails,
      organizationId,
    } = req.body;

    try {
      // Validar o crear cliente
      const customer = await reservationService.ensureClientExists({
        name: customerDetails.name,
        phoneNumber: customerDetails.phone,
        email: customerDetails.email,
        organizationId,
        birthDate: customerDetails.birthDate,
      });

      // Crear reserva
      const newReservation = await reservationService.createReservation({
        serviceId,
        employeeId: employeeId || null,
        startDate,
        customer: customer._id,
        customerDetails: customerDetails,
        organizationId,
      });

      const adminOrganization = await organizationService.getOrganizationById(
        organizationId
      );

      // Crear la notificación
      const notificationData = {
        title: "Nueva reserva",
        message: `Tienes una nueva reserva pendiente por confirmar de ${customerDetails.name}`,
        organizationId: adminOrganization._id,
        type: "reservation",
        frontendRoute: `/gestionar-reservas-online`,
        status: "unread",
      };

      // Guardar la notificación en la base de datos
      await notificationService.createNotification(notificationData);

      const notify = {
        title: "Nueva reserva",
        message: `Tienes una nueva reserva pendiente por confirmar de ${customerDetails.name}`,
        icon: adminOrganization.branding.pwaIcon,
      };

      await subscriptionService.sendNotificationToUser(
        adminOrganization._id,
        JSON.stringify(notify)
      );

      sendResponse(res, 201, newReservation, "Reserva creada exitosamente");
    } catch (error) {
      sendResponse(
        res,
        500,
        null,
        `Error al crear la reserva: ${error.message}`
      );
    }
  },

  // POST /api/reservations/multi
createMultipleReservations: async (req, res) => {
  const {
    services,
    startDate,
    customerDetails,
    organizationId,
  } = req.body;

  if (!services || !Array.isArray(services) || services.length === 0) {
    return sendResponse(res, 400, null, "Debe enviar al menos un servicio.");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Validar o crear cliente (fuera del loop, también dentro de la transacción)
    const customer = await reservationService.ensureClientExists({
      name: customerDetails.name,
      phoneNumber: customerDetails.phone,
      email: customerDetails.email,
      organizationId,
      birthDate: customerDetails.birthDate,
    });

    let currentStart = new Date(startDate);
    const createdReservations = [];

    for (const serviceItem of services) {
      // Buscar duración en backend si no viene (recomendado)
      let duration = serviceItem.duration;
      if (!duration) {
        const serviceObj = await serviceModel.findById(serviceItem.serviceId).session(session);
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

      // IMPORTANTE: usa la sesión en la creación
      const newReservation = await reservationService.createReservation(reservationData, session);
      createdReservations.push(newReservation);

      currentStart.setMinutes(currentStart.getMinutes() + duration);
    }

    // Notificaciones y demás lógica (fuera de la transacción si no afecta la DB, o dentro si también deben ser atómicas)

    await session.commitTransaction();
    session.endSession();

    // Notificación fuera de la transacción (si se cae, igual la data ya está bien)
    const adminOrganization = await organizationService.getOrganizationById(organizationId);
    await notificationService.createNotification({
      title: "Nueva reserva múltiple",
      message: `Tienes nuevas reservas de ${customerDetails.name}`,
      organizationId: adminOrganization._id,
      type: "reservation",
      frontendRoute: `/gestionar-reservas-online`,
      status: "unread",
    });

    await subscriptionService.sendNotificationToUser(
      adminOrganization._id,
      JSON.stringify({
        title: "Nueva reserva múltiple",
        message: `Tienes nuevas reservas de ${customerDetails.name}`,
        icon: adminOrganization.branding.pwaIcon,
      })
    );

    sendResponse(res, 201, createdReservations, "Reservas múltiples creadas exitosamente");
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    sendResponse(res, 500, null, `Error al crear reservas múltiples: ${error.message}`);
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
