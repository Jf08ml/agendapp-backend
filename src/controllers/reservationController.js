import notificationService from "../services/notificationService.js";
import organizationService from "../services/organizationService.js";
import reservationService from "../services/reservationService.js";
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
