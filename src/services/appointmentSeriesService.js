/**
 * 🔁 Servicio para gestión de citas recurrentes
 * Genera ocurrencias, valida disponibilidad y crea series de citas
 */

import moment from 'moment-timezone';
import mongoose from 'mongoose';
import appointmentModel from '../models/appointmentModel.js';
import organizationService from './organizationService.js';
import employeeService from './employeeService.js';
import serviceService from './serviceService.js';
import clientService from './clientService.js';
import whatsappTemplates from '../utils/whatsappTemplates.js';
import { waIntegrationService } from './waIntegrationService.js';
import { hasUsablePhone } from '../utils/timeAndPhones.js';
import cancellationService from './cancellationService.js';
import { generateCancellationLink } from '../utils/cancellationUtils.js';

// 📅 Helpers de formato para mensajes
const fmt = (d, tz = "America/Bogota") =>
  new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  }).format(d);

const fmtTime = (d, tz = "America/Bogota") =>
  new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  }).format(d);

/**
 * Obtiene el horario efectivo para un empleado en un día específico
 * Prioriza horario del empleado, sino usa el de la organización
 * 
 * @param {Object} employee - Documento de empleado
 * @param {Object} organization - Documento de organización
 * @param {number} dayOfWeek - Día de la semana (0=Domingo, 6=Sábado)
 * @returns {Object|null} {isAvailable, start, end, breaks} o null si no disponible
 */
function getEffectiveSchedule(employee, organization, dayOfWeek) {
  // 1. Intentar usar horario personalizado del empleado
  if (employee.weeklySchedule?.enabled && employee.weeklySchedule?.schedule) {
    const empSchedule = employee.weeklySchedule.schedule.find(s => s.day === dayOfWeek);
    if (empSchedule) {
      return {
        isAvailable: empSchedule.isAvailable,
        start: empSchedule.start,
        end: empSchedule.end,
        breaks: empSchedule.breaks || []
      };
    }
  }

  // 2. Fallback a horario de la organización
  if (organization.weeklySchedule?.enabled && organization.weeklySchedule?.schedule) {
    const orgSchedule = organization.weeklySchedule.schedule.find(s => s.day === dayOfWeek);
    if (orgSchedule) {
      return {
        isAvailable: orgSchedule.isOpen,
        start: orgSchedule.start,
        end: orgSchedule.end,
        breaks: orgSchedule.breaks || []
      };
    }
  }

  // 3. Fallback al sistema antiguo (openingHours)
  if (organization.openingHours) {
    const isBusinessDay = organization.openingHours.businessDays?.includes(dayOfWeek) ?? true;
    if (isBusinessDay && organization.openingHours.start && organization.openingHours.end) {
      return {
        isAvailable: true,
        start: organization.openingHours.start,
        end: organization.openingHours.end,
        breaks: organization.openingHours.breaks || []
      };
    }
  }

  return null; // No hay horario definido para este día
}

/**
 * Convierte una hora en formato "HH:mm" a minutos desde medianoche
 */
function timeToMinutes(time) {
  if (!time) return 0;
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Verifica si un slot (inicio + duración) cae dentro del horario de trabajo
 * y no se solapa con periodos de descanso
 * 
 * @param {string} slotTime - Hora del slot "HH:mm"
 * @param {number} durationMinutes - Duración en minutos
 * @param {Object} schedule - {isAvailable, start, end, breaks}
 * @returns {boolean}
 */
function isSlotWithinWorkingHours(slotTime, durationMinutes, schedule) {
  if (!schedule || !schedule.isAvailable) return false;

  const slotStartMin = timeToMinutes(slotTime);
  const slotEndMin = slotStartMin + durationMinutes;
  const workStartMin = timeToMinutes(schedule.start);
  const workEndMin = timeToMinutes(schedule.end);

  // Verificar que el slot esté completamente dentro del horario de trabajo
  if (slotStartMin < workStartMin || slotEndMin > workEndMin) {
    return false;
  }

  // Verificar que no se solape con descansos
  const breaks = schedule.breaks || [];
  for (const breakPeriod of breaks) {
    const breakStartMin = timeToMinutes(breakPeriod.start);
    const breakEndMin = timeToMinutes(breakPeriod.end);

    // Hay solapamiento si el slot empieza antes de que termine el break
    // Y el slot termina después de que empieza el break
    if (slotStartMin < breakEndMin && slotEndMin > breakStartMin) {
      return false;
    }
  }

  return true;
}

/**
 * Genera todas las fechas de ocurrencias según un patrón semanal
 * 
 * @param {Date} baseDate - Fecha/hora base de la primera cita
 * @param {Object} pattern - Patrón de recurrencia
 * @param {string} timezone - Timezone IANA (ej: 'America/Bogota')
 * @returns {Array<{date: Date, dayOfWeek: number}>}
 */
function generateWeeklyOccurrences(baseDateInput, pattern, timezone = 'America/Bogota') {
  const { intervalWeeks = 1, weekdays = [], endType, endDate, count } = pattern;

  if (!weekdays || weekdays.length === 0) {
    throw new Error('Se deben especificar los días de la semana (weekdays)');
  }

  const occurrences = [];
  // Interpretar la hora base en la zona horaria de la organización para evitar desfaces
  const baseMoment = moment.tz(baseDateInput, timezone);
  const baseTime = baseMoment.format('HH:mm:ss'); // Preservar hora exacta
  
  let currentWeekStart = baseMoment.clone().startOf('week'); // Domingo de la semana base
  let iterations = 0;
  const maxIterations = 500; // Seguridad contra loops infinitos

  while (iterations < maxIterations) {
    // Para cada día de la semana especificado
    for (const dayOfWeek of weekdays) {
      const occurrenceDate = currentWeekStart.clone().day(dayOfWeek);
      
      // Aplicar la hora de la cita base
      const [hours, minutes, seconds] = baseTime.split(':');
      occurrenceDate.hours(parseInt(hours));
      occurrenceDate.minutes(parseInt(minutes));
      occurrenceDate.seconds(parseInt(seconds || 0));

      // Validar que la fecha esté en el futuro (o sea la fecha base)
      if (occurrenceDate.isSameOrAfter(baseMoment.clone().startOf('day'))) {
        // Validar límite por fecha
        if (endType === 'date' && endDate) {
          // Tomar solo la parte de fecha y evaluarla en la timezone de la organización
          const endDay = typeof endDate === 'string'
            ? endDate.split('T')[0]
            : moment(endDate).tz(timezone).format('YYYY-MM-DD');
          const endMoment = moment.tz(endDay, 'YYYY-MM-DD', timezone).endOf('day');
          if (occurrenceDate.isAfter(endMoment)) {
            break; // Salir del for de weekdays
          }
        }

        // Validar límite por count
        if (endType === 'count' && count && occurrences.length >= count) {
          break; // Salir del for de weekdays
        }

        occurrences.push({
          date: occurrenceDate.toDate(),
          dayOfWeek: occurrenceDate.day()
        });
      }
    }

    // Verificar si ya llegamos al límite
    if (endType === 'count' && count && occurrences.length >= count) {
      break;
    }

    if (endType === 'date' && endDate) {
      // Inclusivo hasta el final del día límite, ignorando la hora enviada
      const endDay = typeof endDate === 'string'
        ? endDate.split('T')[0]
        : moment(endDate).tz(timezone).format('YYYY-MM-DD');
      const endMoment = moment.tz(endDay, 'YYYY-MM-DD', timezone).endOf('day');
      if (currentWeekStart.isAfter(endMoment)) {
        break;
      }
    }

    // Avanzar N semanas
    currentWeekStart.add(intervalWeeks, 'weeks');
    iterations++;
  }

  return occurrences;
}

/**
 * Valida la disponibilidad de una ocurrencia específica
 * 
 * @param {Date} occurrenceDate - Fecha/hora de la ocurrencia
 * @param {number} durationMinutes - Duración en minutos
 * @param {string} employeeId - ID del empleado
 * @param {string} organizationId - ID de la organización
 * @param {string} timezone - Timezone IANA
 * @returns {Promise<{status: string, reason?: string}>}
 */
async function validateOccurrenceAvailability(
  occurrenceDate,
  durationMinutes,
  employeeId,
  organizationId,
  timezone = 'America/Bogota'
) {
  try {
    // Obtener datos necesarios
    const [employee, organization] = await Promise.all([
      employeeService.getEmployeeById(employeeId),
      organizationService.getOrganizationById(organizationId)
    ]);

    if (!employee || !organization) {
      return { status: 'error', reason: 'Empleado u organización no encontrados' };
    }

    // Obtener día de la semana y hora
    const occMoment = moment.tz(occurrenceDate, timezone);
    const dayOfWeek = occMoment.day();
    const timeString = occMoment.format('HH:mm');

    // Obtener horario efectivo
    const schedule = getEffectiveSchedule(employee, organization, dayOfWeek);

    if (!schedule) {
      return { 
        status: 'no_work', 
        reason: `No hay horario configurado para ${occMoment.format('dddd')}` 
      };
    }

    // Validar que el slot esté dentro del horario de trabajo
    if (!isSlotWithinWorkingHours(timeString, durationMinutes, schedule)) {
      return { 
        status: 'no_work', 
        reason: `Fuera del horario de trabajo (${schedule.start} - ${schedule.end})` 
      };
    }

    // Validar conflictos con citas existentes
    const endDate = occMoment.clone().add(durationMinutes, 'minutes').toDate();
    
    const overlappingAppointments = await appointmentModel.find({
      employee: employeeId,
      organizationId,
      status: { $nin: ['cancelled', 'cancelled_by_customer', 'cancelled_by_admin'] },
      $or: [
        { startDate: { $lt: endDate, $gte: occurrenceDate } },
        { endDate: { $gt: occurrenceDate, $lte: endDate } },
        { startDate: { $lte: occurrenceDate }, endDate: { $gte: endDate } },
      ],
    });

    if (overlappingAppointments.length > 0) {
      return { 
        status: 'conflict', 
        reason: `Conflicto con ${overlappingAppointments.length} cita(s) existente(s)` 
      };
    }

    return { status: 'available' };

  } catch (error) {
    console.error('Error validando disponibilidad:', error);
    return { status: 'error', reason: error.message };
  }
}

/**
 * Genera preview de todas las ocurrencias de una serie
 * Sin crear las citas en la base de datos
 * 
 * @param {Object} baseAppointment - Datos de la cita base
 * @param {Object} recurrencePattern - Patrón de recurrencia
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<{occurrences: Array, summary: Object}>}
 */
async function previewSeriesAppointments(baseAppointment, recurrencePattern, options = {}) {
  const {
    startDate,
    employee,
    services,
    organizationId,
    customPrice,
    additionalItems = []
  } = baseAppointment;

  // Validar que haya servicios
  if (!services || services.length === 0) {
    throw new Error('Se requiere al menos un servicio');
  }

  // Obtener organización para timezone
  const organization = await organizationService.getOrganizationById(organizationId);
  if (!organization) {
    throw new Error('Organización no encontrada');
  }

  const timezone = organization.timezone || 'America/Bogota';

  // Obtener detalles de todos los servicios
  const servicesDetails = await Promise.all(
    services.map(serviceId => serviceService.getServiceById(serviceId))
  );

  // Validar que todos los servicios existan
  if (servicesDetails.some(s => !s)) {
    throw new Error('Uno o más servicios no fueron encontrados');
  }

  // Calcular duración total (suma de todos los servicios)
  const durationMinutes = servicesDetails.reduce((total, s) => total + (s.duration || 60), 0);

  // Generar fechas de ocurrencias
  const occurrenceDates = generateWeeklyOccurrences(
    startDate,
    recurrencePattern,
    timezone
  );

  console.log(`📅 Generadas ${occurrenceDates.length} ocurrencias para preview`);

  // Validar cada ocurrencia
  const validations = await Promise.all(
    occurrenceDates.map(async ({ date, dayOfWeek }) => {
      const validation = await validateOccurrenceAvailability(
        date,
        durationMinutes,
        employee,
        organizationId,
        timezone
      );

      return {
        date: date.toISOString(),
        dayOfWeek,
        status: validation.status,
        reason: validation.reason,
        // Información adicional para el frontend
        formattedDate: moment.tz(date, timezone).format('ddd DD/MM/YYYY'),
        formattedTime: moment.tz(date, timezone).format('HH:mm')
      };
    })
  );

  // Calcular resumen
  const summary = {
    total: validations.length,
    available: validations.filter(v => v.status === 'available').length,
    no_work: validations.filter(v => v.status === 'no_work').length,
    conflict: validations.filter(v => v.status === 'conflict').length,
    error: validations.filter(v => v.status === 'error').length
  };

  summary.willBeCreated = summary.available; // Por defecto solo se crean las disponibles

  return {
    occurrences: validations,
    summary
  };
}

/**
 * Crea una serie completa de citas
 * Omite automáticamente las que tienen status 'no_work' o 'conflict'
 * 
 * @param {Object} baseAppointment - Datos de la cita base
 * @param {Object} recurrencePattern - Patrón de recurrencia
 * @param {Object} options - Opciones de creación
 * @returns {Promise<{seriesId, created, skipped, preview}>}
 */
async function createSeriesAppointments(baseAppointment, recurrencePattern, options = {}) {
  const {
    allowOverbooking = false,
    omitIfNoWork = true,
    omitIfConflict = true,
    skipNotification = false,
    notifyAllAppointments = true // 📨 Por defecto enviar mensaje con todas las citas
  } = options;

  // Generar preview
  const { occurrences, summary } = await previewSeriesAppointments(
    baseAppointment,
    recurrencePattern,
    options
  );

  console.log('📊 Preview generado:', summary);

  // Filtrar ocurrencias que se crearán
  let toCreate = occurrences.filter(occ => {
    if (occ.status === 'error') return false;
    if (occ.status === 'no_work' && omitIfNoWork) return false;
    if (occ.status === 'conflict' && omitIfConflict) return false;
    if (occ.status === 'conflict' && !allowOverbooking) return false;
    return true;
  });

  if (toCreate.length === 0) {
    throw new Error('No hay ocurrencias válidas para crear. Todas fueron omitidas.');
  }

  console.log(`✅ Se crearán ${toCreate.length} de ${occurrences.length} citas`);

  // Generar seriesId único
  const seriesId = new mongoose.Types.ObjectId();

  // 🔗 Generar groupId y token de cancelación ÚNICOS para TODA la serie
  const groupId = new mongoose.Types.ObjectId();
  const { token: cancelToken, hash: cancelTokenHash } = cancellationService.generateCancelToken();
  console.log('🔗 Token y groupId generados para toda la serie:', { seriesId, groupId });

  // Obtener organización y servicios para cálculos
  const organization = await organizationService.getOrganizationById(baseAppointment.organizationId);
  const servicesDetails = await Promise.all(
    baseAppointment.services.map(serviceId => serviceService.getServiceById(serviceId))
  );

  const timezone = organization.timezone || 'America/Bogota';
  
  // Crear citas en transacción
  const session = await mongoose.startSession();
  const created = [];
  let skipped = [];

  try {
    session.startTransaction();

    let occurrenceNumber = 0;

    // Para cada ocurrencia válida
    for (let i = 0; i < toCreate.length; i++) {
      const occurrence = toCreate[i];
      const occurrenceDate = new Date(occurrence.date);
      let currentStartDate = moment.tz(occurrenceDate, timezone);

      // Crear una cita por cada servicio
      for (let serviceIndex = 0; serviceIndex < baseAppointment.services.length; serviceIndex++) {
        const serviceId = baseAppointment.services[serviceIndex];
        const serviceDetails = servicesDetails[serviceIndex];
        const durationMinutes = serviceDetails.duration || 60;
        
        const endDate = currentStartDate.clone().add(durationMinutes, 'minutes').toDate();

        // Calcular precio (puede ser personalizado o del servicio)
        const basePrice = baseAppointment.customPrices?.[serviceId] ?? serviceDetails.price;
        const additionalItemsForService = baseAppointment.additionalItemsByService?.[serviceId] || [];
        const additionalCost = additionalItemsForService.reduce(
          (sum, item) => sum + (item.price * (item.quantity || 1)),
          0
        );
        const totalPrice = basePrice + additionalCost;

        const appointmentData = {
          service: serviceId,
          employee: baseAppointment.employee,
          employeeRequestedByClient: baseAppointment.employeeRequestedByClient || false,
          client: baseAppointment.client,
          startDate: currentStartDate.toDate(),
          endDate: endDate,
          organizationId: baseAppointment.organizationId,
          advancePayment: baseAppointment.advancePayment || 0,
          customPrice: baseAppointment.customPrices?.[serviceId],
          additionalItems: additionalItemsForService,
          totalPrice,
          status: 'pending',
          // 🔁 Campos de serie
          seriesId,
          occurrenceNumber: occurrenceNumber + 1,
          recurrencePattern: occurrenceNumber === 0 ? recurrencePattern : undefined, // Solo en la primera
          // 🔗 Campos de grupo para cancelación conjunta
          groupId,
          cancelTokenHash
        };

        const newAppointment = new appointmentModel(appointmentData);
        const saved = await newAppointment.save({ session });
        created.push(saved);

        // La siguiente cita empieza donde termina esta
        currentStartDate = moment.tz(endDate, timezone);
      }

      occurrenceNumber++;
    }

    await session.commitTransaction();
    console.log(`💾 Serie creada exitosamente: ${created.length} citas (${baseAppointment.services.length} servicios × ${toCreate.length} ocurrencias)`);

  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Error creando serie de citas:', error);
    throw error;
  } finally {
    session.endSession();
  }

  // Registrar omitidas
  skipped = occurrences.filter(occ => 
    !toCreate.some(tc => tc.date === occ.date)
  ).map(occ => ({
    date: occ.date,
    reason: occ.reason,
    status: occ.status
  }));

  // 📱 Enviar mensaje de WhatsApp según configuración
  if (!skipNotification && created.length > 0) {
    try {
      // Cargar datos del cliente y empleado
      const clientDoc = typeof baseAppointment.client === 'string'
        ? await clientService.getClientById(baseAppointment.client)
        : baseAppointment.client;
      
      const employeeDoc = typeof baseAppointment.employee === 'string'
        ? await employeeService.getEmployeeById(baseAppointment.employee)
        : baseAppointment.employee;

      // Verificar que el cliente tenga teléfono utilizable
      const rawPhone = clientDoc?.phoneNumber;
      const usablePhone = hasUsablePhone(rawPhone);
      
      if (!usablePhone) {
        console.warn('⚠️ Cliente sin teléfono utilizable; no se enviará mensaje WhatsApp para la serie.');
      } else {
        const phoneE164 = usablePhone.startsWith('+') ? usablePhone : `+${usablePhone}`;
        
        if (notifyAllAppointments) {
          // 📨 OPCIÓN 1: Enviar UN mensaje con TODAS las citas de la serie
          console.log('📨 Enviando mensaje con TODAS las citas de la serie...');
          
          // 🔗 Generar enlace de cancelación único para TODA la serie
          const cancellationLink = generateCancellationLink(cancelToken, organization);
          
          // Agrupar citas por occurrenceNumber para formatear el mensaje
          const citasPorOcurrencia = {};
          for (const cita of created) {
            const occNum = cita.occurrenceNumber;
            if (!citasPorOcurrencia[occNum]) {
              citasPorOcurrencia[occNum] = [];
            }
            citasPorOcurrencia[occNum].push(cita);
          }

          // Formatear la lista de citas agrupadas por fecha
          const appointmentsList = [];
          for (const [occNum, citasDeOcurrencia] of Object.entries(citasPorOcurrencia).sort((a, b) => a[0] - b[0])) {
            const firstCita = citasDeOcurrencia[0];
            const fecha = new Intl.DateTimeFormat('es-ES', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: timezone
            }).format(firstCita.startDate);
            
            // Formatear servicios de esta ocurrencia
            const serviciosTexto = [];
            for (const cita of citasDeOcurrencia) {
              const svc = await serviceService.getServiceById(cita.service);
              const horaInicio = fmtTime(cita.startDate, timezone);
              const horaFin = fmtTime(cita.endDate, timezone);
              serviciosTexto.push(`     • ${svc.name} (${horaInicio} - ${horaFin})`);
            }
            
            appointmentsList.push(`\n${occNum}. ${fecha}\n${serviciosTexto.join('\n')}`);
          }
          
          const templateData = {
            names: clientDoc?.name || 'Estimado cliente',
            organization: organization.name,
            address: organization.address || '',
            employee: employeeDoc?.names || 'Nuestro equipo',
            appointmentsList: appointmentsList.join('\n'),
            cancellationLink,
          };
          
          // Usar template específico para series recurrentes
          const msg = await whatsappTemplates.getRenderedTemplate(
            baseAppointment.organizationId,
            'recurringAppointmentSeries',
            templateData
          );
          
          // Enviar UN SOLO mensaje
          await waIntegrationService.sendMessage({
            orgId: baseAppointment.organizationId,
            phone: phoneE164,
            message: msg,
            image: null,
          });
          
          console.log(`📱 Mensaje enviado con ${Object.keys(citasPorOcurrencia).length} ocurrencias (${created.length} citas totales)`);
          
        } else {
          // 📨 OPCIÓN 2: Enviar mensaje solo de la PRIMERA ocurrencia
          console.log('📨 Enviando mensaje solo de la PRIMERA ocurrencia...');
          
          // Filtrar solo las citas de la primera ocurrencia (occurrenceNumber: 1)
          const primerasCitas = created.filter(c => c.occurrenceNumber === 1);
          
          if (primerasCitas.length === 0) {
            console.warn('⚠️ No se encontraron citas de la primera ocurrencia');
          } else {
            // Generar token específico para estas citas
            const firstGroupId = new mongoose.Types.ObjectId();
            const { token: firstCancelToken, hash: firstCancelTokenHash } = cancellationService.generateCancelToken();
            
            // Actualizar solo las citas de la primera ocurrencia con un groupId y token específico
            await appointmentModel.updateMany(
              { _id: { $in: primerasCitas.map(c => c._id) } },
              { 
                $set: { 
                  groupId: firstGroupId,
                  cancelTokenHash: firstCancelTokenHash
                } 
              }
            );
            
            const firstCancellationLink = generateCancellationLink(firstCancelToken, organization);
            
            const firstCita = primerasCitas[0];
            const lastCita = primerasCitas[primerasCitas.length - 1];
            
            // Formatear servicios
            const servicesForMsg = await Promise.all(
              primerasCitas.map(async (cita) => {
                const svc = await serviceService.getServiceById(cita.service);
                return {
                  name: svc.name,
                  start: fmtTime(cita.startDate, timezone),
                  end: fmtTime(cita.endDate, timezone),
                };
              })
            );
            
            const dateRange = primerasCitas.length === 1
              ? fmt(firstCita.startDate, timezone)
              : `${fmt(firstCita.startDate, timezone)} – ${fmtTime(lastCita.endDate, timezone)}`;
            
            const templateData = {
              names: clientDoc?.name || 'Estimado cliente',
              dateRange,
              organization: organization.name,
              address: organization.address || '',
              servicesList: servicesForMsg.map((s, i) => `  ${i + 1}. ${s.name} (${s.start} – ${s.end})`).join('\\n'),
              employee: employeeDoc?.names || 'Nuestro equipo',
              cancellationLink: firstCancellationLink,
              // Para template simple (scheduleAppointment) cuando es 1 sola cita
              date: fmt(firstCita.startDate, timezone),
              service: primerasCitas.length === 1 ? servicesForMsg[0].name : ''
            };
            
            // Usar template batch o simple según cantidad de servicios
            const templateType = primerasCitas.length > 1 ? 'scheduleAppointmentBatch' : 'scheduleAppointment';
            
            const msg = await whatsappTemplates.getRenderedTemplate(
              baseAppointment.organizationId,
              templateType,
              templateData
            );
            
            // Enviar mensaje solo de la primera cita
            await waIntegrationService.sendMessage({
              orgId: baseAppointment.organizationId,
              phone: phoneE164,
              message: msg,
              image: null,
            });
            
            console.log(`📱 Mensaje enviado solo de primera ocurrencia (${primerasCitas.length} servicios)`);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error enviando mensaje WhatsApp para serie:', error.message || error);
      // No lanzar error, las citas ya fueron creadas exitosamente
    }
  }

  return {
    seriesId,
    created: created.map(apt => ({
      _id: apt._id,
      startDate: apt.startDate,
      endDate: apt.endDate,
      occurrenceNumber: apt.occurrenceNumber
    })),
    skipped,
    preview: {
      occurrences,
      summary: {
        ...summary,
        created: created.length,
        skipped: skipped.length
      }
    }
  };
}

export default {
  generateWeeklyOccurrences,
  validateOccurrenceAvailability,
  previewSeriesAppointments,
  createSeriesAppointments,
  getEffectiveSchedule, // Export para tests
  isSlotWithinWorkingHours // Export para tests
};
