import appointmentModel from "../models/appointmentModel.js";
import organizationService from "./organizationService.js";
import serviceService from "./serviceService.js";
import whatsappService from "./sendWhatsappService.js";

const appointmentService = {
  // Crear una nueva cita
  createAppointment: async (appointmentData) => {
    const {
      service,
      employee,
      employeeRequestedByClient,
      client,
      startDate,
      endDate,
      organizationId,
      advancePayment,
      customPrice, 
      additionalItems = [],
    } = appointmentData;

    // Comprobar citas superpuestas
    const overlappingAppointments = await appointmentModel.find({
      employee,
      $or: [
        { startDate: { $lt: endDate, $gte: startDate } },
        { endDate: { $gt: startDate, $lte: endDate } },
        { startDate: { $lte: startDate }, endDate: { $gte: endDate } },
      ],
    });

    if (overlappingAppointments.length > 0) {
      throw new Error("El empleado tiene citas que se cruzan");
    }

    // Validar adicionales (opcional)
    additionalItems.forEach((item) => {
      if (!item.name || !item.price || item.price < 0 || item.quantity < 0) {
        throw new Error("Adicionales inválidos en la cita");
      }
    });

    // Obtener el servicio para el precio base
    const serviceDetails = await serviceService.getServiceById(service);
    if (!serviceDetails) {
      throw new Error("Servicio no encontrado");
    }

    const basePrice = customPrice ?? serviceDetails.price; // Usar precio personalizado o el del servicio
    const additionalCost = additionalItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    const totalPrice = basePrice + additionalCost; // Calcular precio total

    // Crear la cita
    const newAppointment = new appointmentModel({
      service,
      employee,
      employeeRequestedByClient,
      client,
      startDate,
      endDate,
      organizationId,
      advancePayment,
      customPrice,
      additionalItems,
      totalPrice, // Asignar precio total calculado
    });

    // Formatear fecha para la confirmación
    const dateObject = new Date(startDate);
    const appointmentDate = dateObject.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "long",
    });

    // Obtener detalles de la organización
    const organization = await organizationService.getOrganizationById(
      organizationId
    );

    const appointmentDetails = {
      name: client?.name || "Estimado cliente",
      date: appointmentDate,
      organization: organization.name,
      service: serviceDetails.name,
      phoneNumber: organization.phoneNumber,
    };

    // Enviar confirmación por WhatsApp
    try {
      await whatsappService.sendWhatsappScheduleAppointment(
        client?.phoneNumber,
        appointmentDetails
      );
    } catch (error) {
      console.error(
        `Error enviando la confirmación para ${client?.phoneNumber}:`,
        error.message
      );
    }

    // Guardar la cita en la base de datos
    return await newAppointment.save();
  },

  // Obtener todas las citas
  getAppointments: async () => {
    return await appointmentModel
      .find()
      .populate("service")
      .populate("employee")
      .populate("client")
      .exec();
  },

  // Obtener citas por organizationId con rango de fechas opcional
  getAppointmentsByOrganizationWithDates: async (
    organizationId,
    startDate,
    endDate
  ) => {
    try {
      const query = { organizationId };

      // Si se especifican fechas, añadirlas al query
      if (startDate && endDate) {
        query.startDate = { $gte: new Date(startDate) };
        query.endDate = { $lte: new Date(endDate) };
      }

      return await appointmentModel
        .find(query)
        .populate("service")
        .populate("employee")
        .populate("client")
        .exec();
    } catch (error) {
      throw new Error(
        "Error al obtener citas de la organización: " + error.message
      );
    }
  },

  // Obtener una cita por ID
  getAppointmentById: async (id) => {
    const appointment = await appointmentModel.findById(id);
    if (!appointment) {
      throw new Error("Cita no encontrada");
    }
    return appointment;
  },

  // Obtener las citas de un empleado
  getAppointmentsByEmployee: async (employeeId) => {
    return await appointmentModel
      .find({ employee: employeeId })
      .populate("service")
      .populate("client")
      .exec();
  },

  // Obtener las citas de un empleado
  getAppointmentsByClient: async (client) => {
    return await appointmentModel.find({ client });
  },

  // Actualizar una cita
  updateAppointment: async (id, updatedData) => {
    const appointment = await appointmentModel.findById(id);

    if (!appointment) {
      throw new Error("Cita no encontrada");
    }

    const { employee, startDate, endDate } = updatedData;

    // Validar citas superpuestas
    if (employee && startDate && endDate) {
      const overlappingAppointments = await appointmentModel.find({
        employee,
        _id: { $ne: id }, // Excluir la cita actual
        $or: [
          { startDate: { $lt: endDate, $gte: startDate } },
          { endDate: { $gt: startDate, $lte: endDate } },
          { startDate: { $lte: startDate }, endDate: { $gte: endDate } },
        ],
      });

      if (overlappingAppointments.length > 0) {
        throw new Error(
          "El empleado tiene citas que se cruzan en el horario seleccionado"
        );
      }
    }

    // Actualizar los datos de la cita
    appointment.set(updatedData);
    return await appointment.save();
  },

  // Eliminar una cita
  deleteAppointment: async (id) => {
    const appointment = await appointmentModel.findById(id);
    if (!appointment) {
      throw new Error("Cita no encontrada");
    }

    await appointment.deleteOne();
    return { message: "Cita eliminada correctamente" };
  },

  sendDailyReminders: async () => {
    const currentDate = new Date();
    const colombiaOffset = -5; // Offset de Colombia respecto a UTC
    const colombiaTime = new Date(
      currentDate.getTime() + colombiaOffset * 60 * 60 * 1000
    );

    // Calcular el rango de fechas para el día siguiente en hora de Colombia
    const tomorrow = new Date(colombiaTime);
    tomorrow.setDate(colombiaTime.getDate() + 1); // Día siguiente
    tomorrow.setHours(8, 0, 0, 0); // Inicio del día siguiente a las 8:00 AM

    const endOfTomorrow = new Date(tomorrow);
    endOfTomorrow.setHours(23, 59, 59, 999); // Fin del día siguiente a las 11:59 PM

    try {
      // Buscar citas para el día siguiente y que aún no se les haya enviado recordatorio
      const appointments = await appointmentModel
        .find({
          startDate: { $gte: tomorrow, $lt: endOfTomorrow },
          reminderSent: false,
        })
        .populate("client")
        .populate("service")
        .populate("employee")
        .populate("organizationId");

      for (const appointment of appointments) {
        const phone = appointment.client.phoneNumber;
        const appointmentDate = appointment.startDate.toLocaleDateString(
          "es-ES",
          {
            day: "numeric",
            month: "long",
          }
        );
        const appointmentDetails = {
          names: appointment.client.name,
          date: appointmentDate,
          organization: appointment.organizationId.name,
          service: `${appointment.service.type} - ${appointment.service.name}`,
          phoneNumber: appointment.organizationId.phoneNumber,
        };

        try {
          await whatsappService.sendWhatsappReminder(phone, appointmentDetails);
          appointment.reminderSent = true;
          await appointment.save();
        } catch (error) {
          console.error(
            `Error enviando recordatorio para ${phone}:`,
            error.message
          );
        }
      }
    } catch (error) {
      console.error("Error ejecutando sendDailyReminders:", error.message);
    }
  },
};

export default appointmentService;
