// src/services/reservationService.js
import Reservation from "../models/reservationModel.js";
import Client from "../models/clientModel.js";
import Organization from "../models/organizationModel.js";
import appointmentService from "./appointmentService.js";
import whatsappService from "./sendWhatsappService.js";
import cancellationService from "./cancellationService.js";
import { normalizePhoneNumber } from "../utils/phoneUtils.js";
import { RES_STATUS } from "../constants/reservationStatus.js";

const reservationService = {
  // Crear una nueva reserva
  createReservation: async (reservationData, session = null) => {
    // 🔐 Generar token de cancelación
    const { token, hash } = cancellationService.generateCancelToken();
    reservationData.cancelTokenHash = hash;
    
    const reservation = new Reservation(reservationData);
    if (session) {
      await reservation.save({ session });
    } else {
      await reservation.save();
    }
    
    // Retornar la reservación con el token (solo en memoria, no guardado en DB)
    reservation._cancelToken = token; // Campo temporal para usar en notificaciones
    
    return reservation;
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
      const skipNotification = updateData.skipNotification || false;

      // Solo crear cita vía batch si pasa a "approved" y no hay appointment aún
      const mustCreateAppointment =
        nextStatus === RES_STATUS.APPROVED && !reservation.appointmentId;

      // 🔇 Si skipNotification es true, NO crear citas aún (esperar a la última)
      if (mustCreateAppointment && !skipNotification && reservation.groupId) {
        // 🎯 Es la última del grupo (skipNotification=false)
        // crear TODAS las citas del grupo juntas
        const groupReservations = await Reservation.find({
          groupId: reservation.groupId
        }).populate("serviceId employeeId customer organizationId");

        // Filtrar solo las que necesitan cita (no tienen appointmentId)
        const needAppointment = groupReservations.filter(r => !r.appointmentId);

        if (needAppointment.length > 0) {
          console.log(`📦 Creando ${needAppointment.length} citas del grupo juntas`);
          
          try {
            // Usar la misma lógica que createMultipleReservations
            const services = needAppointment.map(r => {
              const sObj = typeof r.serviceId === "object" ? r.serviceId : null;
              return sObj?._id || r.serviceId;
            });
            
            // 👤 Extraer array de empleados (uno por cada reserva)
            const employees = needAppointment.map(r => {
              return r.employeeId?._id || r.employeeId || null;
            });
            console.log('👥 Empleados por servicio:', employees);

            const firstRes = needAppointment[0];
            const orgId = firstRes.organizationId._id || firstRes.organizationId;
            
            // 🔗 Usar el groupId de las reservas
            const sharedGroupId = reservation.groupId;
            console.log('🔗 Usando groupId de reservas:', sharedGroupId);
            
            // Crear todas las citas en un solo batch
            const createdAppts = await appointmentService.createAppointmentsBatch({
              services,
              employees, // 👤 Array de empleados (uno por servicio)
              employeeRequestedByClient: !!firstRes.employeeId,
              client: typeof firstRes.customer === "object" 
                ? firstRes.customer._id.toString() 
                : firstRes.customer,
              startDate: firstRes.startDate,
              organizationId: orgId,
              skipNotification: false, // La última SÍ envía mensaje
              sharedGroupId, // 🔗 Pasar el groupId de las reservas
            });

            // Asignar las citas creadas a sus respectivas reservas
            for (let i = 0; i < needAppointment.length; i++) {
              if (createdAppts[i]?._id) {
                needAppointment[i].appointmentId = createdAppts[i]._id;
                needAppointment[i].status = RES_STATUS.APPROVED;
                await needAppointment[i].save();
              }
            }

            console.log(`✅ ${createdAppts.length} citas creadas para el grupo`);
            
            // Recargar la reserva actual
            const updated = await Reservation.findById(id);
            return updated;
          } catch (error) {
            // ❌ Si hay error al crear las citas, revertir TODAS las reservas del grupo a pending
            console.error('❌ Error al crear citas del grupo, revirtiendo estados:', error.message);
            
            await Reservation.updateMany(
              { groupId: reservation.groupId },
              { 
                $set: { status: RES_STATUS.PENDING },
                $unset: { appointmentId: "" }
              }
            );
            
            // Lanzar error con mensaje específico
            throw new Error(
              `No se pudieron crear las citas del grupo: ${error.message}. Todas las reservas del grupo se revirtieron a "pendiente".`
            );
          }
        }
      } else if (mustCreateAppointment && !skipNotification && !reservation.groupId) {
        // Aprobación individual (sin grupo)
        const { serviceId, employeeId, startDate, customer, organizationId } =
          reservation;

        const serviceObj = typeof serviceId === "object" ? serviceId : null;
        if (!serviceObj || !serviceObj.duration) {
          throw new Error(
            "El servicio asociado no es válido o falta la duración"
          );
        }
        if (!startDate) {
          throw new Error("La reserva no tiene una fecha de inicio válida");
        }

        const createdAppts = await appointmentService.createAppointmentsBatch({
          services: [serviceObj._id || serviceId],
          employee: employeeId?._id || employeeId || null,
          employeeRequestedByClient: !!employeeId,
          client: typeof customer === "object" ? customer._id.toString() : customer,
          startDate,
          organizationId: organizationId._id || organizationId,
          skipNotification,
        });

        const createdFirst = Array.isArray(createdAppts)
          ? createdAppts[0]
          : null;
        if (createdFirst?._id) {
          reservation.appointmentId = createdFirst._id;
        }
      }

      // Eliminar skipNotification antes de asignar a la reserva
      const { skipNotification: _skip, ...dataToSave } = updateData;
      Object.assign(reservation, dataToSave);

      // Si se aprobó exitosamente, limpiar el errorMessage
      if (nextStatus === RES_STATUS.APPROVED && reservation.appointmentId) {
        reservation.errorMessage = undefined;
      }

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
    // Primero buscar la reserva para verificar si tiene groupId
    const reservation = await Reservation.findById(id);
    if (!reservation) {
      throw new Error("Reserva no encontrada");
    }

    // Si la reserva pertenece a un grupo, eliminar todas las reservas del grupo
    if (reservation.groupId) {
      const result = await Reservation.deleteMany({ 
        groupId: reservation.groupId 
      });
      return {
        deletedCount: result.deletedCount,
        wasGroup: true,
        groupId: reservation.groupId
      };
    }

    // Si es individual, eliminar solo esa reserva
    const deleted = await Reservation.findByIdAndDelete(id);
    return {
      deletedCount: deleted ? 1 : 0,
      wasGroup: false
    };
  },

  // Validar y crear cliente si no existe
  ensureClientExists: async ({
    name,
    phoneNumber,
    email,
    organizationId,
    birthDate,
  }) => {
    // 🌍 Obtener país por defecto de la organización
    const org = await Organization.findById(organizationId).select('default_country');
    const defaultCountry = org?.default_country || 'CO';

    // 🌍 Normalizar teléfono a E.164
    const phoneResult = normalizePhoneNumber(phoneNumber, defaultCountry);
    if (!phoneResult.isValid) {
      throw new Error(phoneResult.error || 'Número de teléfono inválido');
    }

    // 🔍 Buscar cliente por phone_e164 O phoneNumber (compatibilidad con datos antiguos)
    const existingClient = await Client.findOne({
      organizationId,
      $or: [
        { phone_e164: phoneResult.phone_e164 },
        { phoneNumber: phoneResult.phone_national_clean }
      ]
    });

    if (existingClient) {
      // 🔄 Actualizar campos si han cambiado
      let isUpdated = false;
      
      // Migración automática: actualizar campos de teléfono si faltan
      if (!existingClient.phone_e164) {
        existingClient.phone_e164 = phoneResult.phone_e164;
        existingClient.phone_country = phoneResult.phone_country;
        existingClient.phoneNumber = phoneResult.phone_national_clean;
        isUpdated = true;
      }
      
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

    // 🆕 Crear nuevo cliente con campos normalizados
    const newClient = new Client({
      name,
      phoneNumber: phoneResult.phone_national_clean, // 🆕 Solo dígitos locales
      phone_e164: phoneResult.phone_e164, // Con código de país en formato E.164
      phone_country: phoneResult.phone_country,
      email,
      organizationId,
      birthDate,
    });
    
    try {
      return await newClient.save();
    } catch (error) {
      // Capturar error de duplicado del índice único de MongoDB
      if (error.code === 11000) {
        throw new Error('Ya existe un cliente con este número de teléfono en esta organización');
      }
      throw error;
    }
  },
};

export default reservationService;
