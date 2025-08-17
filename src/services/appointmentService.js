import appointmentModel from "../models/appointmentModel.js";
import organizationService from "./organizationService.js";
import serviceService from "./serviceService.js";
import whatsappService from "./sendWhatsappService.js";
import whatsappTemplates from "../utils/whatsappTemplates.js";

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
    // const overlappingAppointments = await appointmentModel.find({
    //   employee,
    //   $or: [
    //     { startDate: { $lt: endDate, $gte: startDate } },
    //     { endDate: { $gt: startDate, $lte: endDate } },
    //     { startDate: { $lte: startDate }, endDate: { $gte: endDate } },
    //   ],
    // });

    // if (overlappingAppointments.length > 0) {
    //   throw new Error("El empleado tiene citas que se cruzan");
    // }

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

    const appointmentDate = new Intl.DateTimeFormat("es-ES", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/Bogota",
    }).format(dateObject);

    // Obtener detalles de la organización
    const organization = await organizationService.getOrganizationById(
      organizationId
    );

    const appointmentDetails = {
      names: client?.name || "Estimado cliente",
      date: appointmentDate,
      organization: organization.name,
      service: serviceDetails.name,
      employee: employee.names,
      phoneNumber: organization.phoneNumber,
    };

    // Enviar confirmación por WhatsApp
    try {
      const msg = whatsappTemplates.scheduleAppointment(appointmentDetails);

      await whatsappService.sendMessage(
        organizationId,
        client?.phoneNumber,
        msg
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

      // Si NO se especifican fechas, calcular el rango por defecto (mes anterior, actual y siguiente)
      if (!startDate || !endDate) {
        const now = new Date();

        // Primer día del mes anterior
        const firstDayPrevMonth = new Date(
          now.getFullYear(),
          now.getMonth() - 1,
          1
        );

        // Último día del mes siguiente
        const lastDayNextMonth = new Date(
          now.getFullYear(),
          now.getMonth() + 2,
          0,
          23,
          59,
          59,
          999
        );

        startDate = firstDayPrevMonth;
        endDate = lastDayNextMonth;
      }

      // Añadir rango de fechas al query
      query.startDate = { $gte: new Date(startDate) };
      query.endDate = { $lte: new Date(endDate) };

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
    return await appointmentModel
      .find({ client })
      .populate("service")
      .populate("employee")
      .exec();
  },

  // Actualizar una cita
  updateAppointment: async (id, updatedData) => {
    const appointment = await appointmentModel.findById(id);

    if (!appointment) {
      throw new Error("Cita no encontrada");
    }

    const { employee, startDate, endDate } = updatedData;

    // Validar citas superpuestas
    // if (employee && startDate && endDate) {
    //   const overlappingAppointments = await appointmentModel.find({
    //     employee,
    //     _id: { $ne: id }, // Excluir la cita actual
    //     $or: [
    //       { startDate: { $lt: endDate, $gte: startDate } },
    //       { endDate: { $gt: startDate, $lte: endDate } },
    //       { startDate: { $lte: startDate }, endDate: { $gte: endDate } },
    //     ],
    //   });

    //   if (overlappingAppointments.length > 0) {
    //     throw new Error(
    //       "El empleado tiene citas que se cruzan en el horario seleccionado"
    //     );
    //   }
    // }

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
    try {
      // "Ahora" en UTC y su equivalente calendario en Bogotá
      const nowUtc = Date.now();
      const bogotaNow = new Date(nowUtc - 5 * 60 * 60 * 1000); // Bogotá = UTC-5

      const y = bogotaNow.getUTCFullYear();
      const m = bogotaNow.getUTCMonth();
      const d = bogotaNow.getUTCDate();

      // Hoy 00:00 Bogotá -> 05:00 UTC
      const startUTC = new Date(Date.UTC(y, m, d, 5, 0, 0, 0));

      // Hoy 23:59:59.999 Bogotá -> 04:59:59.999 UTC del día siguiente
      const endUTC = new Date(Date.UTC(y, m, d + 1, 4, 59, 59, 999));

      const appointments = await appointmentModel
        .find({
          startDate: { $gte: startUTC, $lt: endUTC },
          reminderSent: false,
        })
        .populate("client")
        .populate("service")
        .populate("employee")
        .populate("organizationId");

      for (const appointment of appointments) {
        const appointmentDateTime = new Intl.DateTimeFormat("es-ES", {
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
          timeZone: "America/Bogota",
        }).format(new Date(appointment.startDate));

        const details = {
          names: appointment.client.name,
          date: appointmentDateTime,
          organization: appointment.organizationId.name,
          employee: appointment.employee.names,
          service: `${appointment.service.type} - ${appointment.service.name}`,
          phoneNumber: appointment.organizationId.phoneNumber,
        };

        try {
          const msg = whatsappTemplates.reminder(details);
          await whatsappService.sendMessage(
            appointment.organizationId._id,
            appointment.client.phoneNumber,
            msg
          );
          appointment.reminderSent = true;
          await appointment.save();
        } catch (e) {
          console.error(
            `Error enviando recordatorio a ${appointment.client.phoneNumber}:`,
            e.message
          );
        }
      }
    } catch (e) {
      console.error("Error ejecutando sendDailyReminders:", e.message);
    }
  },
};

export default appointmentService;
