import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import moment from 'moment-timezone';
import Reservation from '../models/reservationModel.js';
import Appointment from '../models/appointmentModel.js';
import organizationService from './organizationService.js';
import whatsappService from './sendWhatsappService.js';

const cancellationService = {
  /**
   * Genera un token único de cancelación y su hash
   */
  generateCancelToken() {
    // Genera un token único de 32 caracteres
    const token = crypto.randomBytes(32).toString('hex');
    // Hash del token para almacenar en DB
    const hash = bcrypt.hashSync(token, 10);
    return { token, hash };
  },

  /**
   * Verifica si un token es válido comparando con el hash
   */
  async verifyToken(token, hash) {
    return bcrypt.compare(token, hash);
  },

  /**
   * Obtiene información de una reserva/cita usando el token
   * No expone datos sensibles
   */
  async getCancellationInfo(token) {
    try {
      console.log('🔍 [getCancellationInfo] Buscando token:', token);
      
      // 1️⃣ Buscar en Appointments primero
      const appointments = await Appointment.find({ 
        cancelTokenHash: { $exists: true, $ne: null } 
      })
        .select('+cancelTokenHash') // Incluir el campo oculto
        .populate('service', 'name duration')
        .populate('client', 'name')
        .populate('organizationId', 'name timezone')
        .lean();

      console.log(`📋 Encontrados ${appointments.length} appointments con token`);

      for (const appointment of appointments) {
        const isValid = await this.verifyToken(token, appointment.cancelTokenHash);
        console.log(`🔑 Verificando appointment ${appointment._id}: ${isValid}`);
        
        if (isValid) {
          // Si tiene groupId, buscar TODAS las citas del grupo
          let groupAppointments = [appointment];
          
          if (appointment.groupId) {
            console.log(`👥 Buscando citas del grupo: ${appointment.groupId}`);
            groupAppointments = await Appointment.find({ 
              groupId: appointment.groupId 
            })
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
      }

      // 2️⃣ Si no se encontró en Appointments, buscar en Reservations
      const reservations = await Reservation.find({ 
        cancelTokenHash: { $exists: true, $ne: null } 
      })
        .populate('serviceId', 'name duration')
        .populate('organizationId', 'name timezone')
        .lean();

      for (const reservation of reservations) {
        const isValid = await this.verifyToken(token, reservation.cancelTokenHash);
        if (isValid) {
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
      const reservation = await Reservation.findById(reservationId);
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
   */
  async cancelAppointmentsInGroup(appointmentIds, reason = null) {
    try {
      const results = [];
      const cancelledAppointments = []; // Para recopilar info de las citas canceladas
      let organizationId = null;
      let clientPhone = null;
      let clientName = null;
      
      for (const appointmentId of appointmentIds) {
        const appointment = await Appointment.findById(appointmentId)
          .populate('service')
          .populate('client')
          .populate('employee')
          .populate('organizationId');
        
        if (!appointment) {
          results.push({ id: appointmentId, success: false, reason: 'No encontrada' });
          continue;
        }

        // No cancelar si ya está cancelada o es pasada
        if (appointment.status.includes('cancelled')) {
          results.push({ id: appointmentId, success: false, reason: 'Ya cancelada' });
          continue;
        }

        // Guardar info de la organización y cliente para la notificación
        if (!organizationId) {
          organizationId = appointment.organizationId._id || appointment.organizationId;
          const client = appointment.client;
          clientPhone = client?.phoneNumber;
          clientName = client?.name || 'Cliente';
        }

        // 1️⃣ Cancelar la cita
        appointment.status = 'cancelled_by_customer';
        appointment.cancelledAt = new Date();
        appointment.cancelledBy = 'customer';
        await appointment.save();
        
        // Guardar info para el mensaje
        cancelledAppointments.push({
          service: appointment.service?.name || 'Servicio',
          employee: appointment.employee?.name || 'Sin asignar',
          date: appointment.startDate,
          organizationTimezone: appointment.organizationId?.timezone || 'America/Bogota'
        });
        
        // 2️⃣ Buscar y cancelar la reserva asociada (si existe)
        console.log(`🔍 Buscando reserva para appointment ${appointment._id}`);
        const reservation = await Reservation.findOne({ 
          appointmentId: appointment._id,
          status: { $nin: ['cancelled_by_customer', 'cancelled_by_admin'] }
        });
        
        if (reservation) {
          console.log(`📝 Reserva encontrada: ${reservation._id}, status actual: ${reservation.status}`);
          reservation.status = 'cancelled_by_customer';
          reservation.cancelledAt = new Date();
          reservation.cancelledBy = 'customer';
          await reservation.save();
          console.log(`✅ Reserva ${reservation._id} cancelada junto con appointment ${appointmentId}`);
        } else {
          console.log(`⚠️ No se encontró reserva para appointment ${appointment._id}`);
          // Buscar sin el filtro de status para ver si existe
          const anyReservation = await Reservation.findOne({ appointmentId: appointment._id });
          if (anyReservation) {
            console.log(`⚠️ Existe reserva pero con status: ${anyReservation.status}`);
          } else {
            console.log(`⚠️ No existe ninguna reserva con appointmentId: ${appointment._id}`);
          }
        }
        
        results.push({ id: appointmentId, success: true });
      }

      const successCount = results.filter(r => r.success).length;
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
