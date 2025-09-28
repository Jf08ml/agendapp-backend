import Reservation from "../models/reservationModel.js";
import Client from "../models/clientModel.js";
import appointmentService from "./appointmentService.js";
import whatsappService from "./sendWhatsappService.js";

const reservationService = {
  // Crear una nueva reserva
  createReservation: async (reservationData, session = null) => {
    const reservation = new Reservation(reservationData);
    if (session) {
      return await reservation.save({ session });
    }
    return await reservation.save();
  },

  // Obtener todas las reservas de una organización
  getReservationsByOrganization: async (organizationId) => {
    return await Reservation.find({ organizationId }).populate(
      "serviceId employeeId customer"
    );
  },

  // Obtener una reserva por ID
  getReservationById: async (id) => {
    return await Reservation.findById(id).populate(
      "serviceId employeeId customer"
    );
  },

  // Actualizar una reserva
  updateReservation: async (id, updateData) => {
    try {
      // Buscar la reserva y popular los campos necesarios
      const reservation = await Reservation.findById(id).populate(
        "serviceId employeeId customer organizationId"
      );

      if (!reservation) {
        throw new Error("Reserva no encontrada");
      }

      // Validar el estado de actualización
      if (updateData.status === "approved") {
        const { serviceId, employeeId, startDate, customer, organizationId } =
          reservation;

        // Validar que el servicio exista y tenga un objeto válido
        const service = typeof serviceId === "object" ? serviceId : null;
        if (!service || !service.duration) {
          throw new Error(
            "El servicio asociado no es válido o falta la duración"
          );
        }

        if (!startDate) {
          throw new Error("La reserva no tiene una fecha de inicio válida");
        }

        // Calcular la fecha de finalización
        const endDate = new Date(startDate);
        endDate.setMinutes(endDate.getMinutes() + service.duration);

        const newAppointment = {
          service: serviceId._id,
          employee: employeeId?._id || null,
          employeeRequestedByClient: !!employeeId,
          client: customer._id,
          startDate,
          endDate,
          organizationId: organizationId._id,
          status: "pending",
        };

        // Intentar crear la cita
        await appointmentService.createAppointment(newAppointment);
      }

      // Actualizar la reserva con los datos proporcionados
      Object.assign(reservation, updateData);

      const updatedReservation = await reservation.save();

      if (
        updateData.status === "approved" ||
        updateData.status === "rejected"
      ) {
        // Preparar los detalles para el mensaje de WhatsApp
        const appointmentDate = reservation.startDate.toLocaleDateString(
          "es-ES",
          {
            day: "numeric",
            month: "long",
          }
        );

        const reservationDetails = {
          names: reservation.customerDetails?.name || "Estimado cliente",
          date: appointmentDate,
          organization: reservation.organizationId?.name,
          service: reservation.serviceId.name,
          phoneNumber: reservation.organizationId?.phoneNumber,
        };

        // Enviar confirmación por WhatsApp
        // try {
        //   await whatsappService.sendWhatsappStatusReservation(
        //     updateData.status,
        //     reservation,
        //     reservationDetails
        //   );
        // } catch (error) {
        //   console.error(
        //     `Error enviando la confirmación para ${reservation.customerDetails?.phone}:`,
        //     error.message
        //   );
        // }
      }

      return updatedReservation;
    } catch (error) {
      // Manejo general de errores
      if (error.message.includes("citas que se cruzan")) {
        // Error específico de citas cruzadas
        throw new Error(
          "No se pudo crear la cita porque el empleado tiene citas que se cruzan en ese horario."
        );
      }

      // Otros errores
      console.error("Error actualizando la reserva:", error.message);
      throw new Error(`No se pudo actualizar la reserva: ${error.message}`);
    }
  },

  // Eliminar una reserva
  deleteReservation: async (id) => {
    return await Reservation.findByIdAndDelete(id);
  },

  // Validar y crear cliente si no existe
  ensureClientExists: async ({
    name,
    phoneNumber,
    email,
    organizationId,
    birthDate,
  }) => {
    // Buscar cliente existente por teléfono y organización
    const existingClient = await Client.findOne({
      phoneNumber,
      organizationId,
    });

    if (existingClient) {
      let isUpdated = false;

      // Verificar y actualizar si hay diferencias
      if (name && existingClient.name !== name) {
        existingClient.name = name;
        isUpdated = true;
      }

      if (email && existingClient.email !== email) {
        existingClient.email = email;
        isUpdated = true;
      }

      if (birthDate && existingClient.birthDate !== birthDate) {
        existingClient.birthDate = birthDate;
        isUpdated = true;
      }

      // Guardar cambios si hubo actualizaciones
      if (isUpdated) {
        await existingClient.save();
      }

      return existingClient;
    }

    // Crear un nuevo cliente si no existe
    const newClient = new Client({
      name,
      phoneNumber,
      email,
      organizationId,
      birthDate,
    });
    return await newClient.save();
  },
};

export default reservationService;
