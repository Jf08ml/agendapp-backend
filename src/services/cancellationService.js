import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import moment from 'moment-timezone';
import Reservation from '../models/reservationModel.js';
import Appointment from '../models/appointmentModel.js';
import organizationService from './organizationService.js';
import whatsappService from './sendWhatsappService.js';
import notificationService from './notificationService.js';

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
        .select('service client organizationId startDate endDate status groupId cancelTokenHash')
        .populate('service', 'name duration')
        .populate('client', 'name')
        .populate('organizationId', 'name timezone')
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
          .select('+cancelTokenHash service client organizationId startDate endDate status groupId')
          .populate('service', 'name duration')
          .populate('client', 'name')
          .populate('organizationId', 'name timezone')
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
            .select('service client organizationId startDate endDate status groupId')
            .populate('service', 'name duration')
            .populate('client', 'name')
            .populate('organizationId', 'name timezone')
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

        return {
          valid: true,
          type: 'appointment',
          isGroup: !!appointment.groupId,
          groupId: appointment.groupId,
          appointments: groupAppointments.map(apt => ({
            id: apt._id,
            serviceName: apt.service?.name,
            startDate: apt.startDate,
            endDate: apt.endDate,
            status: apt.status,
            isCancelled: apt.status.includes('cancelled'),
            isPast: moment.tz(apt.startDate, timezone).isBefore(now),
          })),
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
        .populate('organizationId', 'name timezone')
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
          .populate('organizationId', 'name timezone')
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

        return {
          valid: true,
          type: 'reservation',
          id: reservation._id,
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
        return await this.cancelReservation(info.id, reason);
      }

      if (info.type === 'appointment') {
        // Si es un grupo y se especificaron IDs, cancelar solo esos
        if (info.isGroup && appointmentIds && appointmentIds.length > 0) {
          return await this.cancelAppointmentsInGroup(appointmentIds, reason);
        }
        
        // Si no se especificaron IDs, cancelar todas las citas del grupo (o la única cita)
        const idsToCancel = info.appointments.map(apt => apt.id);
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

      // 🔔 Crear notificación para el administrador
      try {
        const timezone = reservation.organizationId?.timezone || 'America/Bogota';
        const customerName = reservation.customerDetails?.name || 'Un cliente';
        const serviceName = reservation.serviceId?.name || 'Servicio';
        const formattedDate = moment(reservation.startDate).tz(timezone).format('DD/MM/YYYY [a las] hh:mm A');

        await notificationService.createNotification({
          title: '❌ Reserva cancelada',
          message: `${customerName} canceló su reserva de ${serviceName} programada para el ${formattedDate}`,
          organizationId: reservation.organizationId._id || reservation.organizationId,
          employeeId: null,
          type: 'cancellation',
          status: 'unread',
          frontendRoute: '/manage-agenda'
        });
        
        console.log('🔔 Notificación de cancelación de reserva creada');
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
        .populate('employee', 'name')
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
          employee: apt.employee?.name || 'Sin asignar',
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
          const timezone = cancelledAppointments[0]?.organizationTimezone || 'America/Bogota';
          
          console.log('🔧 Construyendo mensaje para cliente...');
          
          // Construir mensaje de confirmación simplificado
          let message = `Hola ${clientName},\n\n`;
          message += `Tu${cancelledAppointments.length > 1 ? 's' : ''} cita${cancelledAppointments.length > 1 ? 's han' : ' ha'} sido *cancelada${cancelledAppointments.length > 1 ? 's' : ''}* exitosamente:\n\n`;
          
          cancelledAppointments.forEach((apt, index) => {
            const formattedDate = moment(apt.date).tz(timezone).format('DD/MM/YYYY [a las] hh:mm A');
            if (cancelledAppointments.length > 1) {
              message += `${index + 1}. ${apt.service} - ${formattedDate}\n`;
            } else {
              message += `📅 ${formattedDate}\n💼 ${apt.service}\n`;
            }
          });
          
          message += `\nGracias por avisarnos. ¡Esperamos verte pronto! 😊`;

          console.log('📤 Enviando mensaje a:', clientPhone);
          console.log('📄 Mensaje:', message);
          
          await whatsappService.sendMessage(
            organizationId.toString(),
            clientPhone,
            message
          );
          
          console.log(`✅ Mensaje de confirmación enviado a ${clientPhone}`);
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

          await notificationService.createNotification({
            title: cancelledAppointments.length === 1 ? '❌ Cita cancelada' : `❌ ${cancelledAppointments.length} citas canceladas`,
            message: notificationMessage,
            organizationId: organizationId,
            employeeId: null, // Notificación para el admin
            type: 'cancellation',
            status: 'unread',
            frontendRoute: '/manage-agenda'
          });
          
          console.log('🔔 Notificación creada para el administrador');
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
  async cancelAppointment(appointmentId, cancelledBy = 'admin', reason = null) {
    try {
      const appointment = await Appointment.findById(appointmentId);
      if (!appointment) {
        return {
          success: false,
          message: 'Cita no encontrada',
        };
      }

      // Verificar que sea futura (si es cliente)
      if (cancelledBy === 'customer') {
        const org = await organizationService.getOrganizationById(appointment.organizationId);
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
