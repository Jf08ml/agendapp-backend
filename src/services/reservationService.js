// src/services/reservationService.js
import Reservation from "../models/reservationModel.js";
import Client from "../models/clientModel.js";
import appointmentService from "./appointmentService.js";
import whatsappService from "./sendWhatsappService.js";
import { RES_STATUS } from "../constants/reservationStatus.js";

const reservationService = {
  // Crear una nueva reserva
  createReservation: async (reservationData, session = null) => {
    const reservation = new Reservation(reservationData);
    if (session) return await reservation.save({ session });
    return await reservation.save();
  },

  // Obtener todas las reservas de una organización (con orden por fecha)
  getReservationsByOrganization: async (organizationId) => {
    return await Reservation.find({ organizationId })
      .populate("serviceId employeeId customer appointmentId")
      .sort({ startDate: 1, createdAt: -1 }); // primero próximas por fecha
  },

  // (Opcional) Filtrar por estado
  getReservationsByOrgAndStatus: async (organizationId, status) => {
    return await Reservation.find({ organizationId, status })
      .populate("serviceId employeeId customer appointmentId")
      .sort({ startDate: 1, createdAt: -1 });
  },

  // Obtener una reserva por ID
  getReservationById: async (id) => {
    return await Reservation.findById(id).populate(
      "serviceId employeeId customer appointmentId"
    );
  },

  // Actualizar una reserva
  updateReservation: async (id, updateData) => {
    try {
      const reservation = await Reservation.findById(id).populate(
        "serviceId employeeId customer organizationId"
      );
      if (!reservation) throw new Error("Reserva no encontrada");

      const nextStatus = updateData.status;

      // Solo crear cita vía batch si pasa a "approved" y no hay appointment aún
      const mustCreateAppointment =
        nextStatus === RES_STATUS.APPROVED && !reservation.appointmentId;

      if (mustCreateAppointment) {
        const { serviceId, employeeId, startDate, customer, organizationId } =
          reservation;

        // Validaciones mínimas
        const serviceObj = typeof serviceId === "object" ? serviceId : null;
        if (!serviceObj || !serviceObj.duration) {
          throw new Error(
            "El servicio asociado no es válido o falta la duración"
          );
        }
        if (!startDate) {
          throw new Error("La reserva no tiene una fecha de inicio válida");
        }

        // Usa el batch incluso para un solo servicio (reutiliza notificación y lógica)
        const createdAppts = await appointmentService.createAppointmentsBatch({
          services: [serviceObj._id || serviceId], // arreglo obligatorio
          employee: employeeId?._id || employeeId || null, // puede ser null
          employeeRequestedByClient: !!employeeId,
          client: typeof customer === "object" ? customer._id.toString() : customer,
          startDate, // la función encadena si hubiera más servicios
          organizationId: organizationId._id || organizationId,
          // Opcionales si los manejas en tu flujo:
          // advancePayment,
          // customPrices: { [serviceId]: precioCustom },
          // additionalItemsByService: { [serviceId]: [...] },
        });

        // Guarda referencia de la cita creada (primer y único elemento)
        const createdFirst = Array.isArray(createdAppts)
          ? createdAppts[0]
          : null;
        if (createdFirst?._id) {
          reservation.appointmentId = createdFirst._id;
        }
      }

      // Si el estado es auto_approved, aquí NO creamos cita (decisión actual)
      Object.assign(reservation, updateData);

      const updatedReservation = await reservation.save();

      // (Opcional) Notificaciones por WhatsApp según estado
      // if ([RES_STATUS.APPROVED, RES_STATUS.REJECTED, RES_STATUS.AUTO_APPROVED].includes(nextStatus)) {
      //   // ... arma y envía mensaje
      // }

      return updatedReservation;
    } catch (error) {
      if (error.message.includes("citas que se cruzan")) {
        throw new Error(
          "No se pudo crear la cita porque el empleado tiene citas que se cruzan en ese horario."
        );
      }
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
    const existingClient = await Client.findOne({
      phoneNumber,
      organizationId,
    });

    if (existingClient) {
      let isUpdated = false;
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
      if (isUpdated) await existingClient.save();
      return existingClient;
    }

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
