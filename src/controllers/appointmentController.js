import appointmentService from "../services/appointmentService.js";
import organizationService from "../services/organizationService.js";
import subscriptionService from "../services/subscriptionService.js";
import sendResponse from "../utils/sendResponse.js";

const appointmentController = {
  // Controlador para crear una nueva cita
  createAppointment: async (req, res) => {
    try {
      const newAppointment = await appointmentService.createAppointment(
        req.body
      );

      const organization = await organizationService.getOrganizationById(
        newAppointment.organizationId
      );

      const notify = {
        title: "Cita creada",
        message: "Se te ha asignado una nueva cita",
        icon: organization.branding.pwaIcon,
      };
      await subscriptionService.sendNotificationToUser(
        newAppointment.userId,
        JSON.stringify(notify)
      );
      sendResponse(res, 201, newAppointment, "Cita creada exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para crear múltiples citas (batch)
  createAppointmentsBatch: async (req, res) => {
    try {
      const createdAppointments =
        await appointmentService.createAppointmentsBatch(req.body);

      // Notificación webpush (una o varias, según tu UX)
      // Por ejemplo, notificar al empleado:
      if (createdAppointments.length > 0) {
        const org = await organizationService.getOrganizationById(
          createdAppointments[0].organizationId
        );

        const notify = {
          title: "Citas creadas",
          message: `Se te asignaron ${createdAppointments.length} citas`,
          icon: org.branding?.pwaIcon,
        };

        // Usa el campo correcto (employee puede ser id u objeto; ajústalo)
        await subscriptionService.sendNotificationToUser(
          createdAppointments[0].employee,
          JSON.stringify(notify)
        );
      }

      sendResponse(
        res,
        201,
        createdAppointments,
        "Citas creadas exitosamente (batch)"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para obtener todas las citas
  getAppointments: async (req, res) => {
    try {
      const appointments = await appointmentService.getAppointments();
      sendResponse(res, 200, appointments, "Citas obtenidas exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para obtener citas de una organización con rango de fechas opcional
  getAppointmentsByOrganizationWithDates: async (req, res) => {
    const { organizationId } = req.params;
    const { startDate, endDate, employeeIds } = req.query; // Fechas y empleados como query params

    try {
      // Parsear employeeIds si viene como string (ej: "id1,id2,id3")
      let parsedEmployeeIds = null;
      if (employeeIds) {
        parsedEmployeeIds = Array.isArray(employeeIds) 
          ? employeeIds 
          : employeeIds.split(',').filter(id => id.trim());
      }

      const appointments =
        await appointmentService.getAppointmentsByOrganizationWithDates(
          organizationId,
          startDate,
          endDate,
          parsedEmployeeIds
        );
      sendResponse(
        res,
        200,
        appointments,
        "Citas de la organización obtenidas exitosamente"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

    // Controlador para obtener agregados de citas (buckets) timezone-aware
    getAppointmentsAggregated: async (req, res) => {
      const { organizationId } = req.params;
      const { startDate, endDate, granularity, employeeIds } = req.query;

      try {
        let parsedEmployeeIds = null;
        if (employeeIds) {
          parsedEmployeeIds = Array.isArray(employeeIds)
            ? employeeIds
            : employeeIds.split(',').filter(id => id.trim());
        }

        const buckets = await appointmentService.getAppointmentsAggregatedByRange(
          organizationId,
          startDate,
          endDate,
          granularity || 'day',
          parsedEmployeeIds
        );

        sendResponse(res, 200, buckets, 'Buckets de citas obtenidos exitosamente');
      } catch (error) {
        sendResponse(res, 500, null, error.message);
      }
    },

  // Controlador para obtener una cita por ID
  getAppointmentById: async (req, res) => {
    const { id } = req.params;
    try {
      const appointment = await appointmentService.getAppointmentById(id);
      sendResponse(res, 200, appointment, "Cita encontrada");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para obtener las citas de un empleado
  getAppointmentsByEmployee: async (req, res) => {
    const { employeeId } = req.params;
    try {
      const appointments = await appointmentService.getAppointmentsByEmployee(
        employeeId
      );
      sendResponse(
        res,
        200,
        appointments,
        "Citas del empleado obtenidas exitosamente"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para obtener citas por cliente
  getAppointmentsByClient: async (req, res) => {
    const { clientId } = req.params;
    try {
      const appointments = await appointmentService.getAppointmentsByClient(
        clientId
      );
      sendResponse(
        res,
        200,
        appointments,
        "Citas del cliente obtenidas exitosamente"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para actualizar una cita
  updateAppointment: async (req, res) => {
    const { id } = req.params;
    try {
      const updatedAppointment = await appointmentService.updateAppointment(
        id,
        req.body
      );

      const organization = await organizationService.getOrganizationById(
        updatedAppointment.organizationId
      );

      const notify = {
        title: "Cita actualizada",
        message: "Se ha actualizado una cita",
        icon: organization.branding.pwaIcon,
      };

      await subscriptionService.sendNotificationToUser(
        updatedAppointment.employee,
        JSON.stringify(notify)
      );
      sendResponse(
        res,
        200,
        updatedAppointment,
        "Cita actualizada exitosamente"
      );
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para eliminar una cita
  deleteAppointment: async (req, res) => {
    const { id } = req.params;
    try {
      const appointmentData = await appointmentService.getAppointmentById(id);
      const result = await appointmentService.deleteAppointment(id);

      const organization = await organizationService.getOrganizationById(
        appointmentData.organizationId
      );

      const notify = {
        title: "Cita cancelada",
        message: "Se ha cancelado una cita",
        icon: organization.branding.pwaIcon,
      };

      await subscriptionService.sendNotificationToUser(
        appointmentData.employee,
        JSON.stringify(notify)
      );
      sendResponse(res, 200, null, result.message);
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },
};

export default appointmentController;
