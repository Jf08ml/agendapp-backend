import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import moment from 'moment-timezone';
import Reservation from '../models/reservationModel.js';
import Appointment from '../models/appointmentModel.js';
import WhatsappTemplate from '../models/whatsappTemplateModel.js';
import organizationService from './organizationService.js';
import whatsappService from './sendWhatsappService.js';
import notificationService from './notificationService.js';
import whatsappTemplates from '../utils/whatsappTemplates.js';
import packageService from './packageService.js';
import clientService from './clientService.js';

const cancellationService = {
  /**
   * Genera un token único de cancelación y su hash
   * Usa SHA-256 (rápido y determinístico) en lugar de bcrypt
   */
  generateCancelToken() {
    // Genera un token único de 32 bytes = 64 caracteres hex
    const token = crypto.randomBytes(32).toString('hex');
    // Hash SHA-256 del token para almacenar en DB
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    return { token, hash };
  },

  /**
   * Verifica si un token es válido comparando con el hash (bcrypt)
   * SOLO para tokens antiguos - retrocompatibilidad
   */
  async verifyToken(token, hash) {
    return bcrypt.compare(token, hash);
  },

  /**
   * Verifica token con SHA-256 (nuevo sistema)
   */
  verifyTokenSHA256(token, hash) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    return tokenHash === hash;
  },

  /**
   * Obtiene información de una reserva/cita usando el token
   * Sistema optimizado con SHA-256 y fallback a bcrypt para tokens antiguos
   */
  async getCancellationInfo(token) {
    try {
      console.log('🔍 [getCancellationInfo] Buscando token');
      
      const thirtyDaysAgo = moment().subtract(30, 'days').toDate();
      
      // ⚡ PASO 1: Buscar con SHA-256 (tokens nuevos - búsqueda directa)
      const tokenHashSHA256 = crypto.createHash('sha256').update(token).digest('hex');
      
      let appointment = await Appointment.findOne({
        cancelTokenHash: tokenHashSHA256,
        startDate: { $gte: thirtyDaysAgo }
      })
        .select('service client organizationId startDate endDate status clientConfirmed groupId cancelTokenHash')
        .populate('service', 'name duration')
        .populate('client', 'name')
        .populate('organizationId', 'name timezone cancellationPolicy')
        .lean();

      if (appointment) {
        console.log(`⚡ Token SHA-256 encontrado para appointment ${appointment._id}`);
      } else {
        // 🔄 PASO 2: Fallback - Buscar con bcrypt (tokens antiguos)
        console.log('🔄 Token SHA-256 no encontrado, buscando con bcrypt (token antiguo)...');
        
        const appointments = await Appointment.find({
          cancelTokenHash: { $exists: true, $ne: null },
          startDate: { $gte: thirtyDaysAgo }
        })
          .select('+cancelTokenHash service client organizationId startDate endDate status clientConfirmed groupId')
          .populate('service', 'name duration')
          .populate('client', 'name')
          .populate('organizationId', 'name timezone cancellationPolicy')
          .lean();

        console.log(`📋 Buscando en ${appointments.length} appointments con bcrypt...`);

        for (const apt of appointments) {
          const isValid = await this.verifyToken(token, apt.cancelTokenHash);
          
          if (isValid) {
            console.log(`✅ Token bcrypt válido encontrado para appointment ${apt._id}`);
            appointment = apt;
            
            // 🔄 Migrar automáticamente a SHA-256
            console.log('🔄 Migrando token a SHA-256...');
            try {
              await Appointment.findByIdAndUpdate(apt._id, {
                cancelTokenHash: tokenHashSHA256
              });
              console.log('✅ Token migrado exitosamente a SHA-256');
            } catch (migrationError) {
              console.warn('⚠️  No se pudo migrar token (posible duplicado):', migrationError.message);
              // Continuar de todas formas - el token sigue siendo válido
            }
            break;
          }
        }
      }

      if (appointment) {
        // Si tiene groupId, buscar TODAS las citas del grupo en una sola query
        let groupAppointments = [appointment];
        
        if (appointment.groupId) {
          console.log(`👥 Buscando citas del grupo: ${appointment.groupId}`);
          groupAppointments = await Appointment.find({
            groupId: appointment.groupId
          })
            .select('service client organizationId startDate endDate status clientConfirmed groupId')
            .populate('service', 'name duration')
            .populate('client', 'name')
            .populate('organizationId', 'name timezone cancellationPolicy')
            .lean();
          
          console.log(`👥 Encontradas ${groupAppointments.length} citas en el grupo`);
        }

        // Verificar si TODAS ya están canceladas
        const allCancelled = groupAppointments.every(apt => apt.status.includes('cancelled'));
        if (allCancelled) {
          return {
            valid: false,
            reason: groupAppointments.length > 1 
              ? 'Todas las citas de este grupo ya han sido canceladas'
              : 'Esta cita ya ha sido cancelada',
            alreadyCancelled: true,
          };
        }

        // Verificar que sean futuras
        const org = appointment.organizationId;
        const timezone = org.timezone || 'America/Bogota';
        const now = moment.tz(timezone);
        
        // Verificar que al menos una cita sea futura
        const hasFutureAppointments = groupAppointments.some(apt => 
          moment.tz(apt.startDate, timezone).isAfter(now)
        );

        if (!hasFutureAppointments) {
          return {
            valid: false,
            reason: 'No se pueden cancelar citas pasadas',
          };
        }

        // 🚫 Aplicar política de cancelación de la organización
        const cancellationPolicy = org.cancellationPolicy || {};
        const minHours = cancellationPolicy.minHoursBeforeAppointment || 0;
        const preventConfirmed = cancellationPolicy.preventCancellingConfirmed || false;

        // Procesar cada cita y verificar si puede ser cancelada según la política
        const appointmentsWithPolicy = groupAppointments.map(apt => {
          const aptStart = moment.tz(apt.startDate, timezone);
          const hoursUntilAppointment = aptStart.diff(now, 'hours', true);
          const isCancelled = apt.status.includes('cancelled');
          const isPast = aptStart.isBefore(now);

          // Determinar si la cancelación está bloqueada por política
          let policyBlocked = false;
          let policyBlockedReason = null;

          if (!isCancelled && !isPast) {
            // Verificar restricción de horas mínimas
            if (minHours > 0 && hoursUntilAppointment < minHours) {
              policyBlocked = true;
              policyBlockedReason = `No se puede cancelar con menos de ${minHours} horas de anticipación`;
            }

            // Verificar restricción de citas confirmadas (por admin o por cliente)
            if (!policyBlocked && preventConfirmed && (apt.status === 'confirmed' || apt.clientConfirmed)) {
              policyBlocked = true;
              policyBlockedReason = apt.clientConfirmed
                ? 'No se pueden cancelar citas que ya confirmaste'
                : 'No se pueden cancelar citas confirmadas';
            }
          }

          return {
            id: apt._id,
            serviceName: apt.service?.name,
            startDate: apt.startDate,
            endDate: apt.endDate,
            status: apt.status,
            clientConfirmed: apt.clientConfirmed || false,
            isCancelled,
            isPast,
            policyBlocked,
            policyBlockedReason,
          };
        });

        // Verificar si todas las citas cancelables están bloqueadas por política
        const cancellableAppointments = appointmentsWithPolicy.filter(
          apt => !apt.isCancelled && !apt.isPast && !apt.policyBlocked
        );
        const allBlockedByPolicy = appointmentsWithPolicy.some(apt => apt.policyBlocked) &&
          cancellableAppointments.length === 0;

        return {
          valid: true,
          type: 'appointment',
          isGroup: !!appointment.groupId,
          groupId: appointment.groupId,
          appointments: appointmentsWithPolicy,
          allBlockedByPolicy,
          cancellationPolicy: {
            minHoursBeforeAppointment: minHours,
            preventCancellingConfirmed: preventConfirmed,
          },
          data: {
            customerName: appointment.client?.name,
            organizationName: org.name,
            timezone,
          },
        };
      }

      // 2️⃣ Si no se encontró en Appointments, buscar en Reservations
      // Primero intentar con SHA-256
      let reservation = await Reservation.findOne({
        cancelTokenHash: tokenHashSHA256,
        startDate: { $gte: thirtyDaysAgo }
      })
        .select('serviceId organizationId startDate status customerDetails appointmentId cancelTokenHash')
        .populate('serviceId', 'name duration')
        .populate('organizationId', 'name timezone cancellationPolicy')
        .lean();

      if (reservation) {
        console.log(`⚡ Token SHA-256 encontrado para reservation ${reservation._id}`);
      } else {
        // Fallback a bcrypt
        console.log('🔄 Buscando reservations con bcrypt...');
        const reservations = await Reservation.find({
          cancelTokenHash: { $exists: true, $ne: null },
          startDate: { $gte: thirtyDaysAgo }
        })
          .select('+cancelTokenHash serviceId organizationId startDate status customerDetails appointmentId')
          .populate('serviceId', 'name duration')
          .populate('organizationId', 'name timezone cancellationPolicy')
          .lean();

        for (const res of reservations) {
          const isValid = await this.verifyToken(token, res.cancelTokenHash);
          if (isValid) {
            console.log(`✅ Token bcrypt válido encontrado para reservation ${res._id}`);
            reservation = res;
            
            // Migrar a SHA-256
            try {
              await Reservation.findByIdAndUpdate(res._id, {
                cancelTokenHash: tokenHashSHA256
              });
              console.log('✅ Reservation token migrado a SHA-256');
            } catch (migrationError) {
              console.warn('⚠️  No se pudo migrar reservation token:', migrationError.message);
            }
            break;
          }
        }
      }

      if (reservation) {
        // Verificar si ya está cancelada
        if (reservation.status.includes('cancelled')) {
          return {
            valid: false,
            reason: 'Esta reserva ya ha sido cancelada',
            alreadyCancelled: true,
          };
        }

        // Si hay appointment asociado, verificarlo
        if (reservation.appointmentId) {
          const appointment = await Appointment.findById(reservation.appointmentId);
          if (appointment && appointment.status.includes('cancelled')) {
            return {
              valid: false,
              reason: 'Esta cita ya ha sido cancelada',
              alreadyCancelled: true,
            };
          }
        }

        // Verificar que sea futura
        const org = reservation.organizationId;
        const timezone = org.timezone || 'America/Bogota';
        const now = moment.tz(timezone);
        const appointmentTime = moment.tz(reservation.startDate, timezone);

        if (appointmentTime.isBefore(now)) {
          return {
            valid: false,
            reason: 'No se pueden cancelar reservas pasadas',
          };
        }

        // 🚫 Aplicar política de cancelación para reservaciones
        const cancellationPolicy = org.cancellationPolicy || {};
        const minHours = cancellationPolicy.minHoursBeforeAppointment || 0;
        const hoursUntilAppointment = appointmentTime.diff(now, 'hours', true);

        let policyBlocked = false;
        let policyBlockedReason = null;

        if (minHours > 0 && hoursUntilAppointment < minHours) {
          policyBlocked = true;
          policyBlockedReason = `No se puede cancelar con menos de ${minHours} horas de anticipación`;
        }

        return {
          valid: true,
          type: 'reservation',
          id: reservation._id,
          policyBlocked,
          policyBlockedReason,
          cancellationPolicy: {
            minHoursBeforeAppointment: minHours,
            preventCancellingConfirmed: cancellationPolicy.preventCancellingConfirmed || false,
          },
          data: {
            serviceName: reservation.serviceId?.name,
            startDate: reservation.startDate,
            customerName: reservation.customerDetails?.name,
            organizationName: org.name,
            hasAppointment: !!reservation.appointmentId,
          },
        };
      }

      return {
        valid: false,
        reason: 'Token inválido o expirado',
      };
    } catch (error) {
      console.error('[getCancellationInfo] Error:', error);
      return {
        valid: false,
        reason: 'Error al verificar el token',
      };
    }
  },

  /**
   * Cancela una reserva o cita usando el token
   * @param {string} token - Token de cancelación
   * @param {string} reason - Razón de cancelación (opcional)
   * @param {Array<string>} appointmentIds - IDs específicos a cancelar (para grupos)
   */
  async cancelByToken(token, reason = null, appointmentIds = null) {
    try {
      // Primero obtener la info para validar
      const info = await this.getCancellationInfo(token);

      if (!info.valid) {
        return {
          success: false,
          message: info.reason,
          alreadyCancelled: info.alreadyCancelled,
        };
      }

      if (info.type === 'reservation') {
        // 🚫 Verificar política de cancelación para reservaciones
        if (info.policyBlocked) {
          return {
            success: false,
            message: info.policyBlockedReason || 'No se puede cancelar esta reserva según la política de cancelación',
            policyBlocked: true,
          };
        }
        return await this.cancelReservation(info.id, reason);
      }

      if (info.type === 'appointment') {
        // 🚫 Verificar política de cancelación para citas
        // Si se especificaron IDs, verificar que ninguno esté bloqueado por política
        let idsToCancel;

        if (info.isGroup && appointmentIds && appointmentIds.length > 0) {
          // Filtrar IDs que están bloqueados por política
          const blockedIds = info.appointments
            .filter(apt => apt.policyBlocked && appointmentIds.includes(String(apt.id)))
            .map(apt => String(apt.id));

          if (blockedIds.length > 0) {
            const blockedApt = info.appointments.find(apt => blockedIds.includes(String(apt.id)));
            return {
              success: false,
              message: blockedApt?.policyBlockedReason || 'Algunas citas no pueden ser canceladas según la política de cancelación',
              policyBlocked: true,
              blockedAppointments: blockedIds,
            };
          }

          idsToCancel = appointmentIds;
        } else {
          // Si no se especificaron IDs, cancelar todas las citas cancelables
          const cancellableAppointments = info.appointments.filter(
            apt => !apt.isCancelled && !apt.isPast && !apt.policyBlocked
          );

          if (cancellableAppointments.length === 0) {
            // Todas están bloqueadas por política
            const blockedApt = info.appointments.find(apt => apt.policyBlocked);
            return {
              success: false,
              message: blockedApt?.policyBlockedReason || 'No hay citas que se puedan cancelar según la política de cancelación',
              policyBlocked: true,
            };
          }

          idsToCancel = cancellableAppointments.map(apt => apt.id);
        }

        return await this.cancelAppointmentsInGroup(idsToCancel, reason);
      }

      return {
        success: false,
        message: 'Tipo de cancelación no soportado',
      };
    } catch (error) {
      console.error('[cancelByToken] Error:', error);
      return {
        success: false,
        message: 'Error al procesar la cancelación',
      };
    }
  },

  /**
   * Confirma citas usando el mismo token público (misma ruta /cancel en frontend)
   * @param {string} token - Token compartido para confirmación/cancelación
   * @param {Array<string>} appointmentIds - IDs específicos a confirmar (para grupos)
   */
  async confirmByToken(token, appointmentIds = null) {
    try {
      if (!token) {
        return {
          success: false,
          message: 'Token requerido',
        };
      }

      const info = await this.getCancellationInfo(token);

      if (!info.valid) {
        return {
          success: false,
          message: info.reason,
        };
      }

      if (info.type !== 'appointment') {
        return {
          success: false,
          message: 'Solo se pueden confirmar citas',
        };
      }

      const idsToConfirm = info.isGroup && Array.isArray(appointmentIds) && appointmentIds.length
        ? appointmentIds
        : info.appointments.map((apt) => apt.id);

      if (!idsToConfirm.length) {
        return {
          success: false,
          message: 'No hay citas para confirmar',
        };
      }

      const appointments = await Appointment.find({ _id: { $in: idsToConfirm } })
        .populate('client', 'name phoneNumber')
        .populate('service', 'name')
        .populate('employee', 'names')
        .populate('organizationId', 'name timezone');

      const timezone = info.data?.timezone || appointments[0]?.organizationId?.timezone || 'America/Bogota';
      const now = moment.tz(timezone);

      const results = [];
      const confirmedIds = [];
      const confirmedAppointments = [];

      for (const appointment of appointments) {
        const start = moment.tz(appointment.startDate, timezone);

        if (appointment.clientConfirmed) {
          results.push({ id: appointment._id, status: 'already_confirmed' });
          continue;
        }

        if (appointment.status.includes('cancelled')) {
          results.push({ id: appointment._id, status: 'cannot_confirm', reason: 'Cita cancelada' });
          continue;
        }

        if (start.isBefore(now)) {
          results.push({ id: appointment._id, status: 'cannot_confirm', reason: 'No se pueden confirmar citas pasadas' });
          continue;
        }

        // Marcar solo la confirmación del cliente, NO cambiar el status
        appointment.clientConfirmed = true;
        appointment.clientConfirmedAt = now.toDate();
        await appointment.save();
        confirmedIds.push(appointment._id);
        results.push({ id: appointment._id, status: 'client_confirmed' });

        // Guardar datos para mensajes/notificaciones
        confirmedAppointments.push({
          id: appointment._id,
          service: appointment.service?.name || 'Servicio',
          employeeName: appointment.employee?.names || null,
          employeeId: appointment.employee?._id || null,
          date: appointment.startDate,
          organizationTimezone: appointment.organizationId?.timezone || timezone,
        });

        if (appointment.client) {
          try {
            await clientService.registerService(appointment.client);
          } catch (clientError) {
            console.warn('[confirmByToken] No se pudo registrar servicio en cliente:', clientError.message);
          }
        }
      }

      const successCount = confirmedIds.length;
      const alreadyConfirmed = results.filter(r => r.status === 'already_confirmed').length;

      // 📱 Enviar mensaje de WhatsApp de agradecimiento al cliente si hubo confirmaciones
      try {
        if (successCount > 0) {
          const first = appointments[0];
          const organizationId = first.organizationId?._id || first.organizationId;
          const clientPhone = first.client?.phoneNumber;
          const clientName = first.client?.name || 'Cliente';
          const orgTz = first.organizationId?.timezone || timezone;

          if (organizationId && clientPhone) {
            // Verificar si el envío está habilitado para clientConfirmationAck
            let isEnabled = true;
            try {
              const tpl = await WhatsappTemplate.findOne({ organizationId });
              if (tpl && tpl.enabledTypes && typeof tpl.enabledTypes.clientConfirmationAck === 'boolean') {
                isEnabled = tpl.enabledTypes.clientConfirmationAck;
              }
            } catch (e) {
              // Si falla la lectura, asumir habilitado para no bloquear el flujo
              isEnabled = true;
            }

            if (!isEnabled) {
              console.log('⏭️  Envío de clientConfirmationAck deshabilitado para la organización', organizationId.toString());
            } else {
            // Construir appointments_list para el template
            const appointments_list = confirmedAppointments
              .map((apt, idx) => {
                const formattedDate = moment(apt.date).tz(orgTz).format('DD/MM/YYYY [a las] hh:mm A');
                return `  ${idx + 1}. ${apt.service} – ${formattedDate}`;
              })
              .join('\n');

            const message = await whatsappTemplates.getRenderedTemplate(
              organizationId.toString(),
              'clientConfirmationAck',
              {
                names: clientName,
                appointments_list,
              }
            );

            await whatsappService.sendMessage(
              organizationId.toString(),
              clientPhone,
              message
            );
            }
          }
        }
      } catch (whatsappError) {
        console.error('❌ Error al enviar WhatsApp de confirmación:', whatsappError);
      }

      // 🔔 Notificaciones para administrador y empleados (si aplica)
      try {
        if (successCount > 0) {
          const first = appointments[0];
          const organizationId = first.organizationId?._id || first.organizationId;
          const clientName = first.client?.name || 'Cliente';
          const orgTz = first.organizationId?.timezone || timezone;

          if (organizationId) {
            let adminMessage = '';
            if (confirmedAppointments.length === 1) {
              const apt = confirmedAppointments[0];
              const formattedDate = moment(apt.date).tz(orgTz).format('DD/MM/YYYY [a las] hh:mm A');
              adminMessage = `${clientName} confirmó su asistencia a ${apt.service} para el ${formattedDate}`;
            } else {
              adminMessage = `${clientName} confirmó su asistencia en ${confirmedAppointments.length} citas:\n`;
              confirmedAppointments.forEach((apt, index) => {
                const formattedDate = moment(apt.date).tz(orgTz).format('DD/MM/YYYY');
                adminMessage += `${index + 1}. ${apt.service} - ${formattedDate}\n`;
              });
            }

            await notificationService.createNotification({
              title: confirmedAppointments.length === 1 ? '✅ Asistencia confirmada' : `✅ ${confirmedAppointments.length} asistencias confirmadas`,
              message: adminMessage,
              organizationId: organizationId,
              employeeId: null,
              type: 'confirmation',
              status: 'unread',
              frontendRoute: '/manage-agenda',
            });

            // Notificar empleados involucrados (si hay)
            const uniqueEmployeeIds = [...new Set(confirmedAppointments.map(a => a.employeeId).filter(Boolean))];
            for (const employeeId of uniqueEmployeeIds) {
              const employeeAppointments = confirmedAppointments.filter(a => a.employeeId?.toString() === employeeId.toString());
              let employeeMessage = '';
              if (employeeAppointments.length === 1) {
                const apt = employeeAppointments[0];
                const formattedDate = moment(apt.date).tz(orgTz).format('DD/MM/YYYY [a las] hh:mm A');
                employeeMessage = `${clientName} confirmó su asistencia a ${apt.service} para el ${formattedDate}`;
              } else {
                employeeMessage = `${clientName} confirmó su asistencia en ${employeeAppointments.length} de tus citas:\n`;
                employeeAppointments.forEach((apt, index) => {
                  const formattedDate = moment(apt.date).tz(orgTz).format('DD/MM/YYYY');
                  employeeMessage += `${index + 1}. ${apt.service} - ${formattedDate}\n`;
                });
              }

              await notificationService.createNotification({
                title: employeeAppointments.length === 1 ? '✅ Asistencia confirmada' : `✅ ${employeeAppointments.length} asistencias confirmadas`,
                message: employeeMessage,
                organizationId: organizationId,
                employeeId: employeeId,
                type: 'confirmation',
                status: 'unread',
                frontendRoute: '/manage-agenda',
              });
            }
          }
        }
      } catch (notificationError) {
        console.error('❌ Error al crear notificación de confirmación:', notificationError);
      }

      return {
        success: successCount > 0,
        message:
          successCount > 0
            ? `${successCount} cita(s) confirmada(s)${alreadyConfirmed ? `, ${alreadyConfirmed} ya estaban confirmadas` : ''}`
            : alreadyConfirmed > 0
              ? 'Las citas ya estaban confirmadas'
              : 'No se pudieron confirmar las citas',
        data: {
          results,
          successCount,
          alreadyConfirmed,
        },
      };
    } catch (error) {
      console.error('[confirmByToken] Error:', error);
      return {
        success: false,
        message: 'Error al confirmar las citas',
      };
    }
  },

  /**
   * Cancela una reserva y su appointment asociado si existe
   */
  async cancelReservation(reservationId, reason = null) {
    try {
      const reservation = await Reservation.findById(reservationId)
        .populate('serviceId', 'name')
        .populate('organizationId', 'name timezone');
        
      if (!reservation) {
        return {
          success: false,
          message: 'Reserva no encontrada',
        };
      }

      // Actualizar reserva
      reservation.status = 'cancelled_by_customer';
      reservation.cancelledAt = new Date();
      reservation.cancelledBy = 'customer';
      await reservation.save();

      // Si tiene appointment asociado, cancelarlo también
      if (reservation.appointmentId) {
        const appointment = await Appointment.findById(reservation.appointmentId);
        if (appointment) {
          appointment.status = 'cancelled_by_customer';
          appointment.cancelledAt = new Date();
          appointment.cancelledBy = 'customer';
          await appointment.save();
        }
      }

      // 🔔 Crear notificaciones para el administrador y empleado
      try {
        const timezone = reservation.organizationId?.timezone || 'America/Bogota';
        const customerName = reservation.customerDetails?.name || 'Un cliente';
        const serviceName = reservation.serviceId?.name || 'Servicio';
        const formattedDate = moment(reservation.startDate).tz(timezone).format('DD/MM/YYYY [a las] hh:mm A');

        // Notificación para el administrador
        await notificationService.createNotification({
          title: '❌ Reserva cancelada',
          message: `${customerName} canceló su reserva de ${serviceName} programada para el ${formattedDate}`,
          organizationId: reservation.organizationId._id || reservation.organizationId,
          employeeId: null,
          type: 'cancellation',
          status: 'unread',
          frontendRoute: '/manage-agenda'
        });
        console.log('🔔 Notificación de cancelación creada para administrador');

        // Notificación para el empleado (si existe)
        if (reservation.employeeId) {
          await notificationService.createNotification({
            title: '❌ Reserva cancelada',
            message: `${customerName} canceló su reserva de ${serviceName} programada para el ${formattedDate}`,
            organizationId: reservation.organizationId._id || reservation.organizationId,
            employeeId: reservation.employeeId._id || reservation.employeeId,
            type: 'cancellation',
            status: 'unread',
            frontendRoute: '/manage-agenda'
          });
          console.log('🔔 Notificación de cancelación creada para empleado');
        }
      } catch (notificationError) {
        console.error('❌ Error al crear notificación:', notificationError);
      }

      return {
        success: true,
        message: 'Reserva cancelada exitosamente',
        data: {
          reservationId: reservation._id,
          appointmentId: reservation.appointmentId,
        },
      };
    } catch (error) {
      console.error('[cancelReservation] Error:', error);
      return {
        success: false,
        message: 'Error al cancelar la reserva',
      };
    }
  },

  /**
   * Cancela un appointment cuando el cliente usa el enlace de cancelación
   */
  async cancelAppointmentByCustomer(appointmentId, reason = null) {
    try {
      const appointment = await Appointment.findById(appointmentId);
      if (!appointment) {
        return {
          success: false,
          message: 'Cita no encontrada',
        };
      }

      // Actualizar appointment
      appointment.status = 'cancelled_by_customer';
      appointment.cancelledAt = new Date();
      appointment.cancelledBy = 'customer';
      await appointment.save();

      // 📦 Reembolsar sesión del paquete si aplica
      if (appointment.clientPackageId) {
        try {
          await packageService.refundSession(appointment.clientPackageId, appointment.service, appointment._id);
          console.log(`📦 Sesión reembolsada para cita ${appointment._id}`);
        } catch (refundErr) {
          console.error(`⚠️ Error reembolsando sesión:`, refundErr.message);
        }
      }

      return {
        success: true,
        message: 'Cita cancelada exitosamente',
        data: {
          appointmentId: appointment._id,
        },
      };
    } catch (error) {
      console.error('[cancelAppointmentByCustomer] Error:', error);
      return {
        success: false,
        message: 'Error al cancelar la cita',
      };
    }
  },

  /**
   * Cancela múltiples appointments (usado para grupos)
   * OPTIMIZADO: Usa operaciones en batch para mejor rendimiento
   */
  async cancelAppointmentsInGroup(appointmentIds, reason = null) {
    try {
      console.log(`🚀 Cancelando ${appointmentIds.length} citas en batch...`);
      
      // 1️⃣ OPTIMIZACIÓN: Traer todas las citas en UNA SOLA query
      const appointments = await Appointment.find({ 
        _id: { $in: appointmentIds } 
      })
        .populate('service', 'name')
        .populate('client', 'name phoneNumber')
        .populate('employee', 'names') // ⚠️ El campo es 'names' no 'name'
        .populate('organizationId', 'name timezone')
        .lean();

      console.log(`📋 Encontradas ${appointments.length} citas`);

      if (appointments.length === 0) {
        return {
          success: false,
          message: 'No se encontraron citas para cancelar',
        };
      }

      // Separar citas que se pueden cancelar
      const cancellableIds = [];
      const results = [];
      
      for (const appointment of appointments) {
        if (appointment.status.includes('cancelled')) {
          results.push({ id: appointment._id, success: false, reason: 'Ya cancelada' });
        } else {
          cancellableIds.push(appointment._id);
          results.push({ id: appointment._id, success: true });
        }
      }

      if (cancellableIds.length === 0) {
        return {
          success: false,
          message: 'Todas las citas ya estaban canceladas',
          results,
        };
      }

      // Info para notificación (usar la primera cita)
      const firstAppointment = appointments[0];
      const organizationId = firstAppointment.organizationId?._id || firstAppointment.organizationId;
      const clientPhone = firstAppointment.client?.phoneNumber;
      const clientName = firstAppointment.client?.name || 'Cliente';
      const timezone = firstAppointment.organizationId?.timezone || 'America/Bogota';

      // Preparar datos para el mensaje
      const cancelledAppointments = appointments
        .filter(apt => cancellableIds.some(id => id.toString() === apt._id.toString()))
        .map(apt => ({
          service: apt.service?.name || 'Servicio',
          employeeName: apt.employee?.names || 'Sin asignar', // ⚠️ Campo 'names' no 'name'
          employeeId: apt.employee?._id || null, // Guardar el ID del empleado
          date: apt.startDate,
          organizationTimezone: timezone
        }));

      // 2️⃣ OPTIMIZACIÓN: Actualizar TODAS las citas en UNA SOLA operación
      console.log(`💾 Actualizando ${cancellableIds.length} citas en batch...`);
      await Appointment.updateMany(
        { _id: { $in: cancellableIds } },
        { 
          $set: {
            status: 'cancelled_by_customer',
            cancelledAt: new Date(),
            cancelledBy: 'customer'
          }
        }
      );
      console.log(`✅ Citas actualizadas exitosamente`);

      // 📦 Reembolsar sesiones de paquetes para citas canceladas que usaban paquete
      for (const apt of appointments) {
        if (cancellableIds.some(id => id.toString() === apt._id.toString()) && apt.clientPackageId) {
          try {
            await packageService.refundSession(apt.clientPackageId, apt.service?._id || apt.service, apt._id);
            console.log(`📦 Sesión reembolsada para cita ${apt._id}`);
          } catch (refundErr) {
            console.error(`⚠️ Error reembolsando sesión para cita ${apt._id}:`, refundErr.message);
          }
        }
      }

      // 3️⃣ OPTIMIZACIÓN: Actualizar TODAS las reservas asociadas en UNA SOLA operación
      console.log(`🔍 Actualizando reservas asociadas...`);
      const reservationUpdateResult = await Reservation.updateMany(
        { 
          appointmentId: { $in: cancellableIds },
          status: { $nin: ['cancelled_by_customer', 'cancelled_by_admin'] }
        },
        { 
          $set: {
            status: 'cancelled_by_customer',
            cancelledAt: new Date(),
            cancelledBy: 'customer'
          }
        }
      );
      console.log(`✅ ${reservationUpdateResult.modifiedCount} reservas actualizadas`);

      const successCount = cancellableIds.length;
      const failedCount = results.length - successCount;

      // 📱 Enviar mensaje de WhatsApp al cliente si hubo cancelaciones exitosas
      console.log('📱 Verificando envío de WhatsApp:', {
        successCount,
        organizationId,
        clientPhone,
        clientName
      });
      
      if (successCount > 0 && organizationId && clientPhone) {
        try {
          const tz = cancelledAppointments[0]?.organizationTimezone || 'America/Bogota';

          // Construir appointments_list para el template
          const appointments_list = cancelledAppointments
            .map((apt, index) => {
              const formattedDate = moment(apt.date).tz(tz).format('DD/MM/YYYY [a las] hh:mm A');
              return `  ${index + 1}. ${apt.service} – ${formattedDate}`;
            })
            .join('\n');

          // Verificar si el envío está habilitado para clientCancellationAck
          let isEnabled = true;
          try {
            const tpl = await WhatsappTemplate.findOne({ organizationId });
            if (tpl && tpl.enabledTypes && typeof tpl.enabledTypes.clientCancellationAck === 'boolean') {
              isEnabled = tpl.enabledTypes.clientCancellationAck;
            }
          } catch (e) {
            isEnabled = true;
          }

          if (!isEnabled) {
            console.log('⏭️  Envío de clientCancellationAck deshabilitado para la organización', organizationId.toString());
          } else {
            const message = await whatsappTemplates.getRenderedTemplate(
              organizationId.toString(),
              'clientCancellationAck',
              {
                names: clientName,
                appointments_list,
              }
            );

            await whatsappService.sendMessage(
              organizationId.toString(),
              clientPhone,
              message
            );
          }

          console.log(`✅ Mensaje de cancelación enviado a ${clientPhone}`);
        } catch (whatsappError) {
          console.error('❌ Error al enviar mensaje de WhatsApp:', whatsappError);
          console.error('Stack:', whatsappError.stack);
          // No fallar la cancelación si falla el mensaje
        }
      } else {
        console.log('⚠️ No se envió mensaje. Razón:', {
          noSuccess: successCount === 0,
          noOrg: !organizationId,
          noPhone: !clientPhone
        });
      }

      // 🔔 Crear notificación para el administrador
      if (successCount > 0 && organizationId) {
        try {
          const timezone = cancelledAppointments[0]?.organizationTimezone || 'America/Bogota';
          
          // Construir mensaje de la notificación
          let notificationMessage = '';
          if (cancelledAppointments.length === 1) {
            const apt = cancelledAppointments[0];
            const formattedDate = moment(apt.date).tz(timezone).format('DD/MM/YYYY [a las] hh:mm A');
            notificationMessage = `${clientName} canceló su cita de ${apt.service} programada para el ${formattedDate}`;
          } else {
            notificationMessage = `${clientName} canceló ${cancelledAppointments.length} citas:\n`;
            cancelledAppointments.forEach((apt, index) => {
              const formattedDate = moment(apt.date).tz(timezone).format('DD/MM/YYYY');
              notificationMessage += `${index + 1}. ${apt.service} - ${formattedDate}\n`;
            });
          }

          // Notificación para el administrador
          await notificationService.createNotification({
            title: cancelledAppointments.length === 1 ? '❌ Cita cancelada' : `❌ ${cancelledAppointments.length} citas canceladas`,
            message: notificationMessage,
            organizationId: organizationId,
            employeeId: null,
            type: 'cancellation',
            status: 'unread',
            frontendRoute: '/manage-agenda'
          });
          console.log('🔔 Notificación creada para el administrador');

          // Notificaciones para los empleados afectados
          console.log('👤 Verificando empleados para notificar...');
          console.log('📋 Appointments cancelados:', cancelledAppointments.map(a => ({ service: a.service, employeeName: a.employeeName, employeeId: a.employeeId })));
          
          // Obtener empleados únicos (solo los que tienen employeeId)
          const uniqueEmployeeIds = [...new Set(cancelledAppointments.map(apt => apt.employeeId).filter(Boolean))];
          console.log('👥 Empleados únicos a notificar (IDs):', uniqueEmployeeIds);
          
          for (const employeeId of uniqueEmployeeIds) {
            const employeeAppointments = cancelledAppointments.filter(apt => apt.employeeId?.toString() === employeeId.toString());
            const employeeName = employeeAppointments[0]?.employeeName || 'Empleado';
            
            console.log(`📧 Creando notificación para ${employeeName} (ID: ${employeeId}, ${employeeAppointments.length} citas)`);
            
            let employeeMessage = '';
            if (employeeAppointments.length === 1) {
              const apt = employeeAppointments[0];
              const formattedDate = moment(apt.date).tz(timezone).format('DD/MM/YYYY [a las] hh:mm A');
              employeeMessage = `${clientName} canceló su cita de ${apt.service} programada para el ${formattedDate}`;
            } else {
              employeeMessage = `${clientName} canceló ${employeeAppointments.length} citas tuyas:\n`;
              employeeAppointments.forEach((apt, index) => {
                const formattedDate = moment(apt.date).tz(timezone).format('DD/MM/YYYY');
                employeeMessage += `${index + 1}. ${apt.service} - ${formattedDate}\n`;
              });
            }

            await notificationService.createNotification({
              title: employeeAppointments.length === 1 ? '❌ Cita cancelada' : `❌ ${employeeAppointments.length} citas canceladas`,
              message: employeeMessage,
              organizationId: organizationId,
              employeeId: employeeId,
              type: 'cancellation',
              status: 'unread',
              frontendRoute: '/manage-agenda'
            });
            console.log(`🔔 Notificación creada para empleado: ${employeeName} (ID: ${employeeId})`);
          }
        } catch (notificationError) {
          console.error('❌ Error al crear notificación:', notificationError);
          // No fallar la cancelación si falla la notificación
        }
      }

      return {
        success: successCount > 0,
        message: successCount === results.length 
          ? `${successCount} cita(s) cancelada(s) exitosamente`
          : `${successCount} cita(s) cancelada(s), ${failedCount} no se pudieron cancelar`,
        data: {
          results,
          successCount,
          failedCount,
        },
      };
    } catch (error) {
      console.error('[cancelAppointmentsInGroup] Error:', error);
      return {
        success: false,
        message: 'Error al cancelar las citas',
      };
    }
  },

  /**
   * Cancela un appointment directamente (para admin)
   */
  async cancelAppointment(appointmentId, cancelledBy = 'admin', reason = null, notifyClient = false) {
    try {
      const appointment = await Appointment.findById(appointmentId)
        .populate('client')
        .populate('service')
        .populate('employee')
        .populate('organizationId');
        
      if (!appointment) {
        return {
          success: false,
          message: 'Cita no encontrada',
        };
      }

      // Verificar que sea futura (si es cliente)
      if (cancelledBy === 'customer') {
        const org = await organizationService.getOrganizationById(appointment.organizationId._id || appointment.organizationId);
        const timezone = org.timezone || 'America/Bogota';
        const now = moment.tz(timezone);
        const appointmentTime = moment.tz(appointment.startDate, timezone);

        if (appointmentTime.isBefore(now)) {
          return {
            success: false,
            message: 'No se pueden cancelar citas pasadas',
          };
        }
      }

      appointment.status = `cancelled_by_${cancelledBy}`;
      appointment.cancelledAt = new Date();
      appointment.cancelledBy = cancelledBy;
      await appointment.save();

      // Buscar y cancelar la reserva asociada si existe
      const reservation = await Reservation.findOne({ appointmentId: appointmentId });
      if (reservation) {
        reservation.status = `cancelled_by_${cancelledBy}`;
        reservation.cancelledAt = new Date();
        reservation.cancelledBy = cancelledBy;
        await reservation.save();
      }

      // 📩 Enviar WhatsApp al cliente si se solicitó
      if (notifyClient && appointment.client && appointment.organizationId) {
        try {
          const org = appointment.organizationId;
          const client = appointment.client;
          const timezone = org.timezone || 'America/Bogota';
          const organizationId = org._id || org;
          
          // Formatear la cita cancelada
          const appointmentDate = moment.tz(appointment.startDate, timezone);
          const appointmentsList = `• ${appointment.service?.name || 'Servicio'} - ${appointmentDate.format('DD/MM/YYYY HH:mm')}`;
          
          // Usar plantilla personalizada si existe, sino la por defecto
          const message = await whatsappTemplates.getRenderedTemplate(
            organizationId.toString(),
            'clientCancellationAck',
            {
              names: client.name || 'Cliente',
              appointments_list: appointmentsList,
              organization: org.name,
            }
          );

          // Enviar el mensaje
          const phoneNumber = client.phone_e164 || client.phoneNumber;
          if (phoneNumber) {
            await whatsappService.sendMessage(
              organizationId.toString(),
              phoneNumber,
              message
            );
            console.log(`✅ Mensaje de cancelación enviado al cliente: ${client.name} (${phoneNumber})`);
          }
        } catch (whatsappError) {
          console.error('[cancelAppointment] Error al enviar WhatsApp:', whatsappError);
          // No fallar la cancelación si falla el WhatsApp
        }
      }

      return {
        success: true,
        message: 'Cita cancelada exitosamente',
        data: {
          appointmentId: appointment._id,
          reservationId: reservation?._id,
        },
      };
    } catch (error) {
      console.error('[cancelAppointment] Error:', error);
      return {
        success: false,
        message: 'Error al cancelar la cita',
      };
    }
  },
};

export default cancellationService;
