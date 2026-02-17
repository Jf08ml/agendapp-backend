// src/services/reservationService.js
import Reservation from "../models/reservationModel.js";
import Client from "../models/clientModel.js";
import Organization from "../models/organizationModel.js";
import Appointment from "../models/appointmentModel.js";
import Service from "../models/serviceModel.js";
import Employee from "../models/employeeModel.js";
import appointmentService from "./appointmentService.js";
import whatsappService from "./sendWhatsappService.js";
import cancellationService from "./cancellationService.js";
import { waIntegrationService } from "./waIntegrationService.js";
import whatsappTemplates from "../utils/whatsappTemplates.js";
import { generateCancellationLink } from "../utils/cancellationUtils.js";
import { normalizePhoneNumber } from "../utils/phoneUtils.js";
import { RES_STATUS } from "../constants/reservationStatus.js";
import moment from "moment-timezone";

// 📲 Helper: enviar WhatsApp consolidado para serie recurrente aprobada
async function _sendRecurringApprovalWhatsApp({ allCreatedAppts, customerDetails, org, organizationId, timezone, cancellationLink }) {
  if (!customerDetails?.phone) return;

  // Cargar las citas con sus relaciones
  const appointmentIds = allCreatedAppts.map(a => a._id).filter(Boolean);
  const appointments = await Appointment.find({ _id: { $in: appointmentIds } })
    .populate("service employee")
    .sort({ startDate: 1 });

  if (appointments.length === 0) return;

  const fmtTime = (d, tz) =>
    new Intl.DateTimeFormat("es-ES", {
      hour: "2-digit", minute: "2-digit", hour12: true, timeZone: tz,
    }).format(new Date(d));

  // Agrupar por occurrenceNumber
  const citasPorOcurrencia = {};
  for (const cita of appointments) {
    const occNum = cita.occurrenceNumber || 1;
    if (!citasPorOcurrencia[occNum]) citasPorOcurrencia[occNum] = [];
    citasPorOcurrencia[occNum].push(cita);
  }

  // Formatear lista de citas por fecha
  const appointmentsList = [];
  for (const [occNum, citas] of Object.entries(citasPorOcurrencia).sort((a, b) => a[0] - b[0])) {
    const firstCita = citas[0];
    const fecha = new Intl.DateTimeFormat('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone,
    }).format(new Date(firstCita.startDate));

    const serviciosTexto = [];
    for (const cita of citas) {
      const svcName = cita.service?.name || 'Servicio';
      serviciosTexto.push(`     • ${svcName} (${fmtTime(cita.startDate, timezone)} - ${fmtTime(cita.endDate, timezone)})`);
    }

    appointmentsList.push(`\n${occNum}. ${fecha}\n${serviciosTexto.join('\n')}`);
  }

  // Obtener empleado principal
  const empDoc = appointments[0]?.employee;

  const templateData = {
    names: customerDetails.name || 'Estimado cliente',
    organization: org.name,
    address: org.address || '',
    employee: empDoc?.names || 'Nuestro equipo',
    appointmentsList: appointmentsList.join('\n'),
    cancellationLink: cancellationLink || '',
  };

  const msg = await whatsappTemplates.getRenderedTemplate(
    organizationId,
    'recurringAppointmentSeries',
    templateData
  );

  await waIntegrationService.sendMessage({
    orgId: organizationId,
    phone: customerDetails.phone,
    message: msg,
    image: null,
  });

  console.log(`✅ WhatsApp recurrente enviado al aprobar: ${Object.keys(citasPorOcurrencia).length} ocurrencias`);
}

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
            const firstRes = needAppointment[0];
            const orgId = firstRes.organizationId._id || firstRes.organizationId;
            const sharedGroupId = reservation.groupId;

            // 📦 Obtener clientPackageId si alguna reserva del grupo lo tiene
            const pkgRes = groupReservations.find(r => r.clientPackageId);
            const groupClientPackageId = pkgRes?.clientPackageId || null;

            // 🔁 Detectar si es grupo recurrente (diferentes fechas)
            // Buscar recurrenceInfo en alguna reserva del grupo
            const recurrenceRes = groupReservations.find(r => r.recurrenceInfo?.seriesId);
            const isRecurring = !!recurrenceRes;

            if (isRecurring) {
              // 🔁 RECURRENTE: agrupar reservas por fecha de ocurrencia y crear batch por cada una
              console.log('🔁 Aprobando serie recurrente, agrupando por fecha');

              const org = await Organization.findById(orgId);
              const timezone = org?.timezone || "America/Bogota";
              const seriesId = recurrenceRes.recurrenceInfo.seriesId;

              // Agrupar por fecha (YYYY-MM-DD en timezone de la org)
              const byDate = {};
              for (const r of needAppointment) {
                const dateKey = moment(r.startDate).tz(timezone).format("YYYY-MM-DD");
                if (!byDate[dateKey]) byDate[dateKey] = [];
                byDate[dateKey].push(r);
              }

              const sortedDates = Object.keys(byDate).sort();
              console.log(`📅 ${sortedDates.length} fechas de ocurrencia encontradas`);

              // 🔐 Generar token de cancelación compartido para toda la serie
              const { token: sharedToken, hash: sharedTokenHash } = cancellationService.generateCancelToken();
              const cancellationLink = generateCancellationLink(sharedToken, org);

              let occurrenceNumber = 0;
              const allCreatedAppts = [];

              for (const dateKey of sortedDates) {
                occurrenceNumber++;
                const dateReservations = byDate[dateKey];

                const services = dateReservations.map(r => {
                  const sObj = typeof r.serviceId === "object" ? r.serviceId : null;
                  return sObj?._id || r.serviceId;
                });

                const employees = dateReservations.map(r => {
                  return r.employeeId?._id || r.employeeId || null;
                });

                // Usar el startDate de la primera reserva de esta fecha
                const occStartDate = dateReservations[0].startDate;

                const createdAppts = await appointmentService.createAppointmentsBatch({
                  services,
                  employees,
                  employeeRequestedByClient: !!dateReservations[0].employeeId,
                  client: typeof firstRes.customer === "object"
                    ? firstRes.customer._id.toString()
                    : firstRes.customer,
                  startDate: occStartDate,
                  organizationId: orgId,
                  skipNotification: true, // No notificar individualmente
                  sharedGroupId,
                  sharedTokenHash, // 🔐 Token compartido para cancelar toda la serie
                  ...(groupClientPackageId ? { clientPackageId: groupClientPackageId } : {}),
                });

                // Asignar seriesId y occurrenceNumber a las citas creadas
                for (const apt of createdAppts) {
                  if (apt?._id) {
                    await apt.updateOne({ seriesId, occurrenceNumber });
                  }
                }

                // Vincular citas a sus reservas
                for (let i = 0; i < dateReservations.length; i++) {
                  if (createdAppts[i]?._id) {
                    dateReservations[i].appointmentId = createdAppts[i]._id;
                    dateReservations[i].status = RES_STATUS.APPROVED;
                    await dateReservations[i].save();
                  }
                }

                allCreatedAppts.push(...createdAppts);
              }

              console.log(`✅ ${allCreatedAppts.length} citas recurrentes creadas en ${sortedDates.length} fechas`);

              // 📲 Enviar WhatsApp con TODAS las citas de la serie
              try {
                await _sendRecurringApprovalWhatsApp({
                  allCreatedAppts,
                  customerDetails: firstRes.customerDetails || reservation.customerDetails,
                  org,
                  organizationId: orgId,
                  timezone,
                  cancellationLink,
                });
              } catch (whatsappErr) {
                console.error('⚠️ Error enviando WhatsApp recurrente (no bloquea):', whatsappErr.message);
              }

              // Recargar la reserva actual
              const updated = await Reservation.findById(id);
              return updated;
            }

            // 📦 NO RECURRENTE: crear todas las citas en un solo batch (lógica original)
            const services = needAppointment.map(r => {
              const sObj = typeof r.serviceId === "object" ? r.serviceId : null;
              return sObj?._id || r.serviceId;
            });

            const employees = needAppointment.map(r => {
              return r.employeeId?._id || r.employeeId || null;
            });
            console.log('👥 Empleados por servicio:', employees);
            console.log('🔗 Usando groupId de reservas:', sharedGroupId);

            const createdAppts = await appointmentService.createAppointmentsBatch({
              services,
              employees,
              employeeRequestedByClient: !!firstRes.employeeId,
              client: typeof firstRes.customer === "object"
                ? firstRes.customer._id.toString()
                : firstRes.customer,
              startDate: firstRes.startDate,
              organizationId: orgId,
              skipNotification: false,
              sharedGroupId,
              ...(groupClientPackageId ? { clientPackageId: groupClientPackageId } : {}),
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
          ...(reservation.clientPackageId ? { clientPackageId: reservation.clientPackageId } : {}),
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

  // Cancelar una reserva (soft: cambia status a cancelled_by_admin + cancela citas vinculadas)
  cancelReservation: async (id, options = {}) => {
    const { notifyClient = false } = options;
    const reservation = await Reservation.findById(id).populate("organizationId");
    if (!reservation) {
      throw new Error("Reserva no encontrada");
    }

    let reservationsToCancel = [reservation];
    if (reservation.groupId) {
      reservationsToCancel = await Reservation.find({ groupId: reservation.groupId });
    }

    let cancelledAppointments = 0;
    const cancelledAppointmentIds = [];

    for (const res of reservationsToCancel) {
      // Cancelar cita vinculada si existe (sin notificar individualmente)
      if (res.appointmentId) {
        try {
          const result = await cancellationService.cancelAppointment(res.appointmentId.toString(), 'admin', null, false);
          if (result.success) {
            cancelledAppointments++;
            cancelledAppointmentIds.push(res.appointmentId);
          }
        } catch (err) {
          console.error(`⚠️ Error cancelando cita ${res.appointmentId}:`, err.message);
        }
      }

      // Cambiar status de la reserva
      res.status = "cancelled_by_admin";
      res.cancelledAt = new Date();
      res.cancelledBy = "admin";
      await res.save();
    }

    // 📲 Enviar UN solo WhatsApp consolidado con todas las citas canceladas
    if (notifyClient && cancelledAppointmentIds.length > 0) {
      try {
        const org = reservation.organizationId && typeof reservation.organizationId === "object"
          ? reservation.organizationId
          : await Organization.findById(reservation.organizationId);
        const timezone = org?.timezone || "America/Bogota";
        const organizationId = org?._id?.toString() || reservation.organizationId?.toString();

        // Cargar citas con servicio para formatear el listado
        const appointments = await Appointment.find({ _id: { $in: cancelledAppointmentIds } })
          .populate("service client")
          .sort({ startDate: 1 });

        if (appointments.length > 0) {
          const clientPhone = appointments[0].client?.phone_e164 || appointments[0].client?.phoneNumber
            || reservation.customerDetails?.phone;
          const clientName = appointments[0].client?.name || reservation.customerDetails?.name || "Cliente";

          // Formatear lista de citas
          const appointmentsList = appointments.map(apt => {
            const date = moment(apt.startDate).tz(timezone).format("DD/MM/YYYY HH:mm");
            return `• ${apt.service?.name || "Servicio"} - ${date}`;
          }).join("\n");

          const msg = await whatsappTemplates.getRenderedTemplate(
            organizationId,
            "clientCancellationAck",
            {
              names: clientName,
              appointments_list: appointmentsList,
            }
          );

          if (clientPhone) {
            await waIntegrationService.sendMessage({
              orgId: organizationId,
              phone: clientPhone,
              message: msg,
              image: null,
            });
            console.log(`✅ WhatsApp de cancelación consolidado enviado: ${cancelledAppointmentIds.length} citas`);
          }
        }
      } catch (whatsappErr) {
        console.error("⚠️ Error enviando WhatsApp de cancelación (no bloquea):", whatsappErr.message);
      }
    }

    return {
      cancelledCount: reservationsToCancel.length,
      cancelledAppointments,
      wasGroup: !!reservation.groupId,
      groupId: reservation.groupId || null,
    };
  },

  // Eliminar una reserva (hard delete: borra reservas + elimina citas de la DB)
  deleteReservation: async (id, options = {}) => {
    const { deleteAppointments = false } = options;

    const reservation = await Reservation.findById(id);
    if (!reservation) {
      throw new Error("Reserva no encontrada");
    }

    let reservationsToDelete = [reservation];
    if (reservation.groupId) {
      reservationsToDelete = await Reservation.find({ groupId: reservation.groupId });
    }

    let deletedAppointments = 0;

    // Eliminar citas vinculadas de la DB si se solicitó
    if (deleteAppointments) {
      const appointmentIds = reservationsToDelete
        .map(r => r.appointmentId)
        .filter(Boolean);

      for (const aptId of appointmentIds) {
        try {
          await appointmentService.deleteAppointment(aptId.toString());
          deletedAppointments++;
        } catch (err) {
          console.error(`⚠️ Error eliminando cita ${aptId}:`, err.message);
        }
      }
    }

    // Eliminar las reservas
    if (reservation.groupId) {
      const result = await Reservation.deleteMany({ groupId: reservation.groupId });
      return {
        deletedCount: result.deletedCount,
        wasGroup: true,
        groupId: reservation.groupId,
        deletedAppointments,
      };
    }

    const deleted = await Reservation.findByIdAndDelete(id);
    return {
      deletedCount: deleted ? 1 : 0,
      wasGroup: false,
      deletedAppointments,
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
