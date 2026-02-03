/**
 * Servicio para validar y gestionar horarios de disponibilidad
 * Considera tanto los horarios de la organización como los de los empleados
 */

import moment from 'moment-timezone';

/**
 * Obtiene el día de la semana de una fecha en formato "YYYY-MM-DD"
 * independiente de la zona horaria del servidor
 * @param {string} dateString - Fecha en formato "YYYY-MM-DD"
 * @param {string} timezone - Zona horaria IANA (ej: 'America/Bogota', 'America/Mexico_City')
 * @returns {number} Día de la semana (0=Domingo, 6=Sábado)
 */
function getDayOfWeekFromDateString(dateString, timezone = 'America/Bogota') {
  // Usar moment-timezone para asegurar que la fecha se interprete en la zona horaria correcta
  return moment.tz(dateString, timezone).day();
}

/**
 * Convierte una hora en formato "HH:mm" a minutos desde medianoche
 * @param {string} time - Hora en formato "HH:mm" (ej: "14:30")
 * @returns {number} Minutos desde medianoche
 */
function timeToMinutes(time) {
  if (!time) return 0;
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Convierte minutos desde medianoche a formato "HH:mm"
 * @param {number} minutes - Minutos desde medianoche
 * @returns {string} Hora en formato "HH:mm"
 */
function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Verifica si una hora está dentro de un rango
 * @param {string} time - Hora a verificar "HH:mm"
 * @param {string} start - Hora inicio "HH:mm"
 * @param {string} end - Hora fin "HH:mm"
 * @returns {boolean}
 */
function isTimeInRange(time, start, end) {
  const timeMin = timeToMinutes(time);
  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  return timeMin >= startMin && timeMin < endMin;
}

/**
 * Verifica si una hora está dentro de un rango (incluye el fin)
 * Útil para validar que el fin de un slot esté dentro del horario
 * @param {string} time - Hora a verificar "HH:mm"
 * @param {string} start - Hora inicio "HH:mm"
 * @param {string} end - Hora fin "HH:mm"
 * @returns {boolean}
 */
function isTimeInRangeInclusive(time, start, end) {
  const timeMin = timeToMinutes(time);
  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  return timeMin >= startMin && timeMin <= endMin;
}

/**
 * Verifica si una hora está en un periodo de descanso
 * @param {string} time - Hora a verificar "HH:mm"
 * @param {Array} breaks - Array de objetos {start, end}
 * @returns {boolean}
 */
function isTimeInBreak(time, breaks) {
  if (!breaks || breaks.length === 0) return false;
  
  return breaks.some(breakPeriod => {
    return isTimeInRange(time, breakPeriod.start, breakPeriod.end);
  });
}

/**
 * Verifica si un slot (inicio + duración) se solapa con algún periodo de descanso
 * @param {string} slotStart - Hora inicio del slot "HH:mm"
 * @param {number} durationMinutes - Duración en minutos
 * @param {Array} breaks - Array de objetos {start, end, day (opcional)}
 * @param {number} dayOfWeek - Día de la semana (0=Domingo, 6=Sábado) - opcional
 * @returns {boolean}
 */
function isSlotInBreak(slotStart, durationMinutes, breaks, dayOfWeek = null) {
  if (!breaks || breaks.length === 0) return false;
  
  const slotStartMin = timeToMinutes(slotStart);
  const slotEndMin = slotStartMin + durationMinutes;
  
  return breaks.some(breakPeriod => {
    // Si el break tiene campo "day", verificar que coincida con el día del slot
    if (dayOfWeek !== null && breakPeriod.day !== undefined && breakPeriod.day !== null) {
      if (breakPeriod.day !== dayOfWeek) {
        return false; // Este break no aplica para este día
      }
    }
    
    const breakStartMin = timeToMinutes(breakPeriod.start);
    const breakEndMin = timeToMinutes(breakPeriod.end);
    
    // Hay solapamiento si:
    // - El slot empieza antes de que termine el break Y
    // - El slot termina después de que empieza el break
    return slotStartMin < breakEndMin && slotEndMin > breakStartMin;
  });
}

/**
 * Obtiene el horario de la organización para un día específico
 * @param {Object} organization - Documento de organización
 * @param {number} dayOfWeek - Día de la semana (0=Domingo, 6=Sábado)
 * @returns {Object|null} {isOpen, start, end, breaks} o null si está cerrado
 */
function getOrganizationDaySchedule(organization, dayOfWeek) {
  // Si tiene horario semanal habilitado
  if (organization.weeklySchedule?.enabled && organization.weeklySchedule?.schedule) {
    const daySchedule = organization.weeklySchedule.schedule.find(s => s.day === dayOfWeek);
    
    if (daySchedule && daySchedule.isOpen) {
      return {
        isOpen: true,
        start: daySchedule.start,
        end: daySchedule.end,
        breaks: daySchedule.breaks || [],
      };
    }
    return null; // Cerrado ese día
  }

  // Fallback al sistema antiguo (openingHours)
  if (organization.openingHours) {
    const isBusinessDay = organization.openingHours.businessDays?.includes(dayOfWeek) ?? true;
    
    if (isBusinessDay && organization.openingHours.start && organization.openingHours.end) {
      // Filtrar breaks que correspondan al día actual
      const dayBreaks = (organization.openingHours.breaks || []).filter(breakPeriod => {
        // Si el break no tiene el campo 'day', se asume que aplica para todos los días
        if (breakPeriod.day === undefined || breakPeriod.day === null) {
          return true;
        }
        // Si tiene campo 'day', solo incluirlo si coincide con el día actual
        return breakPeriod.day === dayOfWeek;
      });
      
      return {
        isOpen: true,
        start: organization.openingHours.start,
        end: organization.openingHours.end,
        breaks: dayBreaks,
      };
    }
  }
  
  return null;
}

/**
 * Obtiene el horario del empleado para un día específico
 * @param {Object} employee - Documento de empleado
 * @param {number} dayOfWeek - Día de la semana (0=Domingo, 6=Sábado)
 * @returns {Object|null} {isAvailable, start, end, breaks} o null si no está disponible
 */
function getEmployeeDaySchedule(employee, dayOfWeek) {
  // Si tiene horario semanal habilitado
  if (employee.weeklySchedule?.enabled && employee.weeklySchedule?.schedule) {
    const daySchedule = employee.weeklySchedule.schedule.find(s => s.day === dayOfWeek);
    
    if (daySchedule && daySchedule.isAvailable) {
      return {
        isAvailable: true,
        start: daySchedule.start,
        end: daySchedule.end,
        breaks: daySchedule.breaks || [],
      };
    }
    return null; // No disponible ese día
  }

  // Si no tiene horario configurado, asumimos que está disponible según el horario de la organización
  return { isAvailable: true, useOrgSchedule: true };
}

/**
 * Valida si una fecha/hora es válida considerando los horarios de organización y empleado
 * @param {Date} datetime - Fecha y hora a validar
 * @param {Object} organization - Documento de organización
 * @param {Object} employee - Documento de empleado (opcional)
 * @returns {Object} {valid: boolean, reason: string}
 */
function validateDateTime(datetime, organization, employee = null) {
  const timezone = organization.timezone || 'America/Bogota';
  // Convertir la fecha a la timezone de la organización
  const datetimeInTz = moment.tz(datetime, timezone);
  const dayOfWeek = datetimeInTz.day();
  const timeStr = datetimeInTz.format('HH:mm');

  // 1. Verificar horario de la organización
  const orgSchedule = getOrganizationDaySchedule(organization, dayOfWeek);
  
  if (!orgSchedule) {
    return {
      valid: false,
      reason: 'La organización está cerrada en este día',
    };
  }

  if (!isTimeInRange(timeStr, orgSchedule.start, orgSchedule.end)) {
    return {
      valid: false,
      reason: `La organización opera de ${orgSchedule.start} a ${orgSchedule.end}`,
    };
  }

  if (isTimeInBreak(timeStr, orgSchedule.breaks)) {
    return {
      valid: false,
      reason: 'Este horario está en un periodo de descanso de la organización',
    };
  }

  // 2. Si hay empleado, verificar su horario
  if (employee) {
    const empSchedule = getEmployeeDaySchedule(employee, dayOfWeek);
    
    if (!empSchedule) {
      return {
        valid: false,
        reason: 'El empleado no está disponible en este día',
      };
    }

    // Si el empleado no usa el horario de la organización, verificar su horario personal
    if (!empSchedule.useOrgSchedule) {
      if (!isTimeInRange(timeStr, empSchedule.start, empSchedule.end)) {
        return {
          valid: false,
          reason: `El empleado trabaja de ${empSchedule.start} a ${empSchedule.end}`,
        };
      }

      if (isTimeInBreak(timeStr, empSchedule.breaks)) {
        return {
          valid: false,
          reason: 'Este horario está en un periodo de descanso del empleado',
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Genera slots de tiempo disponibles para un día específico
 * @param {Date} date - Fecha para la cual generar slots
 * @param {Object} organization - Documento de organización
 * @param {Object} employee - Documento de empleado (opcional)
 * @param {number} durationMinutes - Duración del servicio en minutos
 * @param {Array} appointments - Citas existentes (opcional, para filtrar slots ocupados)
 * @param {number} maxConcurrentAppointments - Máximo de citas simultáneas que puede atender el empleado (default 1)
 * @returns {Array} Array de objetos {time: "HH:mm", available: boolean}
 */
function generateAvailableSlots(date, organization, employee = null, durationMinutes = 30, appointments = [], maxConcurrentAppointments = 1) {
  const timezone = organization.timezone || 'America/Bogota';
  // Obtener día de la semana en la timezone de la organización
  const dateInTz = moment.tz(date, timezone);
  const dayOfWeek = dateInTz.day();
  const slots = [];

  // Obtener horarios
  const orgSchedule = getOrganizationDaySchedule(organization, dayOfWeek);
  if (!orgSchedule) return []; // Organización cerrada

  let empSchedule = null;
  if (employee) {
    empSchedule = getEmployeeDaySchedule(employee, dayOfWeek);
    if (!empSchedule) return []; // Empleado no disponible
  }

  // Determinar el rango de tiempo efectivo
  let effectiveStart = orgSchedule.start;
  let effectiveEnd = orgSchedule.end;
  let effectiveBreaks = [...(orgSchedule.breaks || [])];

  // Si el empleado tiene horario propio, ajustar el rango
  if (empSchedule && !empSchedule.useOrgSchedule) {
    // El rango efectivo es la intersección de ambos horarios
    const empStartMin = timeToMinutes(empSchedule.start);
    const empEndMin = timeToMinutes(empSchedule.end);
    const orgStartMin = timeToMinutes(effectiveStart);
    const orgEndMin = timeToMinutes(effectiveEnd);
    
    effectiveStart = empStartMin > orgStartMin 
      ? empSchedule.start 
      : effectiveStart;
    
    effectiveEnd = empEndMin < orgEndMin 
      ? empSchedule.end 
      : effectiveEnd;
    
    // Validar que la intersección sea válida
    if (timeToMinutes(effectiveStart) >= timeToMinutes(effectiveEnd)) {
      // No hay intersección válida entre horarios
      return [];
    }
    
    // Combinar breaks
    effectiveBreaks = [...effectiveBreaks, ...(empSchedule.breaks || [])];
  }

  // Obtener el intervalo de minutos
  const stepMinutes = organization.weeklySchedule?.stepMinutes || 
                      organization.openingHours?.stepMinutes || 
                      30;

  // Filtrar citas del empleado si está especificado
  const relevantAppointments = employee 
    ? appointments.filter(a => a.employee && a.employee.toString() === employee._id.toString())
    : appointments;

  // Generar slots
  const startMin = timeToMinutes(effectiveStart);
  const endMin = timeToMinutes(effectiveEnd);

  for (let currentMin = startMin; currentMin < endMin; currentMin += stepMinutes) {
    const slotTime = minutesToTime(currentMin);
    const slotEndMin = currentMin + durationMinutes;
    
    // Verificar si el slot completo está dentro del horario
    if (slotEndMin > endMin) break;
    
    // Verificar si el slot se solapa con algún break (pasamos el día para validar breaks por día)
    const overlapsBreak = isSlotInBreak(slotTime, durationMinutes, effectiveBreaks, dayOfWeek);
    
    // 👥 Contar citas simultáneas en lugar de solo verificar conflictos
    // Esto permite que un empleado atienda múltiples clientes si maxConcurrentAppointments > 1
    let simultaneousAppointmentCount = 0;
    relevantAppointments.forEach(appt => {
      // Convertir las fechas de la cita a la timezone de la organización
      const apptStartInTz = moment.tz(appt.startDate, timezone);
      const apptEndInTz = moment.tz(appt.endDate, timezone);
      
      // Verificar que la cita es del mismo día que estamos generando slots
      const apptDateStr = apptStartInTz.format('YYYY-MM-DD');
      const currentDateStr = dateInTz.format('YYYY-MM-DD');
      
      // Si la cita no es del día que estamos generando, ignorarla
      if (apptDateStr !== currentDateStr) {
        return;
      }
      
      const apptStart = apptStartInTz.hours() * 60 + apptStartInTz.minutes();
      const apptEnd = apptEndInTz.hours() * 60 + apptEndInTz.minutes();
      
      // Hay solapamiento si el slot empieza antes de que termine la cita
      // Y el slot termina después de que empieza la cita
      if (currentMin < apptEnd && slotEndMin > apptStart) {
        simultaneousAppointmentCount++;
      }
    });
    
    // Slot disponible si no se solapa con breaks y no excede el límite concurrente
    const overlapsAppointment = simultaneousAppointmentCount >= maxConcurrentAppointments;
    
    // Crear datetime usando moment-timezone con la zona horaria de la organización
    const hours = Math.floor(currentMin / 60);
    const minutes = currentMin % 60;
    const datetime = moment.tz(
      `${dateInTz.format('YYYY-MM-DD')} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
      timezone
    ).toDate();
    
    slots.push({
      time: slotTime,
      available: !overlapsBreak && !overlapsAppointment,
      datetime,
    });
  }

  // Filtrar horarios pasados si la fecha es hoy
  const nowInTz = moment.tz(timezone);
  const todayStr = nowInTz.format('YYYY-MM-DD');
  const requestDateStr = dateInTz.format('YYYY-MM-DD');
  
  if (todayStr === requestDateStr) {
    // Solo mantener slots que están en el futuro
    return slots.filter(slot => {
      if (!slot.available) return true; // Mantener slots no disponibles para no alterar la UI
      return moment.tz(slot.datetime, timezone).isAfter(nowInTz);
    });
  }

  return slots;
}

/**
 * Obtiene los días de la semana en que está abierto
 * @param {Object} organization - Documento de organización
 * @returns {Array} Array de números de días (0-6)
 */
function getOpenDays(organization) {
  if (organization.weeklySchedule?.enabled && organization.weeklySchedule?.schedule) {
    return organization.weeklySchedule.schedule
      .filter(s => s.isOpen)
      .map(s => s.day);
  }

  // Fallback al sistema antiguo
  return organization.openingHours?.businessDays || [1, 2, 3, 4, 5];
}

/**
 * Obtiene los días en que un empleado está disponible
 * @param {Object} employee - Documento de empleado
 * @param {Object} organization - Documento de organización
 * @returns {Array} Array de números de días (0-6)
 */
function getEmployeeAvailableDays(employee, organization) {
  if (employee.weeklySchedule?.enabled && employee.weeklySchedule?.schedule) {
    return employee.weeklySchedule.schedule
      .filter(s => s.isAvailable)
      .map(s => s.day);
  }

  // Si no tiene horario configurado, usar el de la organización
  return getOpenDays(organization);
}

/**
 * Verifica si un empleado está disponible en un día específico
 * @param {Object} employee - Documento de empleado
 * @param {number} dayOfWeek - Día de la semana (0-6)
 * @param {Object} organization - Documento de organización
 * @returns {boolean}
 */
function isEmployeeAvailableOnDay(employee, dayOfWeek, organization) {
  // Verificar que la organización esté abierta ese día
  const orgSchedule = getOrganizationDaySchedule(organization, dayOfWeek);
  if (!orgSchedule) return false;
  
  // Verificar disponibilidad del empleado
  const empSchedule = getEmployeeDaySchedule(employee, dayOfWeek);
  if (!empSchedule) return false;
  
  return true;
}

/**
 * Asigna el mejor empleado disponible para un slot específico
 * Prioriza empleados con menor carga de trabajo ese día
 * @param {Object} opts - Opciones
 * @param {Array} opts.candidateEmployees - Empleados candidatos
 * @param {Date} opts.date - Fecha del slot
 * @param {string} opts.startTime - Hora inicio "HH:mm"
 * @param {number} opts.duration - Duración en minutos
 * @param {Array} opts.existingAppointments - Citas existentes
 * @param {number} opts.dayOfWeek - Día de la semana (0-6)
 * @param {Object} opts.organization - Documento de organización
 * @returns {Object|null} Empleado asignado o null si ninguno disponible
 */
function assignBestEmployeeForSlot(opts) {
  const { candidateEmployees, date, startTime, duration, existingAppointments, dayOfWeek, organization } = opts;
  const timezone = organization.timezone || 'America/Bogota';
  
  // Filtrar por disponibilidad de horario
  const available = candidateEmployees.filter(emp => {
    const empSchedule = getEmployeeDaySchedule(emp, dayOfWeek, organization);
    if (!empSchedule) return false;
    
    const startMin = timeToMinutes(startTime);
    const endMin = startMin + duration;
    const endTime = minutesToTime(endMin);
    
    // Determinar el horario efectivo (considerando org y empleado)
    const orgSchedule = getOrganizationDaySchedule(organization, dayOfWeek);
    if (!orgSchedule) return false;
    
    let effectiveStart = orgSchedule.start;
    let effectiveEnd = orgSchedule.end;
    let effectiveBreaks = [...(orgSchedule.breaks || [])];
    
    if (!empSchedule.useOrgSchedule) {
      // Calcular intersección
      const empStartMin = timeToMinutes(empSchedule.start);
      const empEndMin = timeToMinutes(empSchedule.end);
      const orgStartMin = timeToMinutes(effectiveStart);
      const orgEndMin = timeToMinutes(effectiveEnd);
      
      effectiveStart = empStartMin > orgStartMin ? empSchedule.start : effectiveStart;
      effectiveEnd = empEndMin < orgEndMin ? empSchedule.end : effectiveEnd;
      
      // Validar intersección válida
      if (timeToMinutes(effectiveStart) >= timeToMinutes(effectiveEnd)) {
        return false;
      }
      
      effectiveBreaks = [...effectiveBreaks, ...(empSchedule.breaks || [])];
    }
    
    // Verificar que el slot esté dentro del horario efectivo
    // El inicio debe estar dentro del rango (exclusivo del fin)
    // El fin puede coincidir exactamente con el cierre (inclusivo)
    if (!isTimeInRange(startTime, effectiveStart, effectiveEnd) ||
        !isTimeInRangeInclusive(endTime, effectiveStart, effectiveEnd)) {
      return false;
    }
    
    // Verificar que no esté en break (CORREGIDO: ahora verifica todo el slot)
    if (isSlotInBreak(startTime, duration, effectiveBreaks)) {
      return false;
    }
    
    return true;
  });
  
  if (available.length === 0) return null;
  
  // Filtrar por citas (sin overlap)
  const free = available.filter(emp => {
    const empAppts = existingAppointments.filter(a => 
      a.employee && a.employee.toString() === emp._id.toString()
    );
    
    const startMin = timeToMinutes(startTime);
    const endMin = startMin + duration;
    
    return !empAppts.some(appt => {
      // Convertir las fechas de la cita a la timezone de la organización
      const apptStartInTz = moment.tz(appt.startDate, timezone);
      const apptEndInTz = moment.tz(appt.endDate, timezone);
      
      // Verificar que la cita es del mismo día
      const dateInTz = moment.tz(date, timezone);
      const apptDateStr = apptStartInTz.format('YYYY-MM-DD');
      const currentDateStr = dateInTz.format('YYYY-MM-DD');
      
      // Si la cita no es del día que estamos evaluando, ignorarla
      if (apptDateStr !== currentDateStr) {
        return false;
      }
      
      const apptStart = apptStartInTz.hours() * 60 + apptStartInTz.minutes();
      const apptEnd = apptEndInTz.hours() * 60 + apptEndInTz.minutes();
      return (startMin < apptEnd && endMin > apptStart);
    });
  });
  
  if (free.length === 0) return null;
  
  // Seleccionar el que tiene menos citas ese día
  // Convertir date a formato YYYY-MM-DD en la timezone de la organización
  const dateInTz = moment.tz(date, timezone);
  const dateStr = dateInTz.format('YYYY-MM-DD');
  
  const sorted = free.map(emp => {
    const count = existingAppointments.filter(a => {
      if (!a.employee || a.employee.toString() !== emp._id.toString()) return false;
      
      // Comparar fechas en la timezone de la organización
      const apptDateStr = moment.tz(a.startDate, timezone).format('YYYY-MM-DD');
      return apptDateStr === dateStr;
    }).length;
    
    return { emp, count };
  }).sort((a, b) => a.count - b.count);
  
  return sorted[0].emp;
}

/**
 * Encuentra bloques de tiempo disponibles para múltiples servicios encadenados
 * @param {Date} date - Fecha
 * @param {Object} organization - Documento de organización
 * @param {Array} services - Array de servicios [{serviceId, employeeId|null, duration}]
 * @param {Array} allEmployees - Todos los empleados relevantes
 * @param {Array} appointments - Citas existentes del día
 * @returns {Array} Array de bloques disponibles
 */
function findAvailableMultiServiceBlocks(date, organization, services, allEmployees, appointments) {
  const timezone = organization.timezone || 'America/Bogota';
  // Obtener día de la semana en la timezone de la organización
  const dateInTz = moment.tz(date, timezone);
  const dayOfWeek = dateInTz.day();
  
  // Verificar que la organización esté abierta ese día
  const orgSchedule = getOrganizationDaySchedule(organization, dayOfWeek);
  if (!orgSchedule) return [];
  
  const stepMinutes = organization.weeklySchedule?.stepMinutes || 
                      organization.openingHours?.stepMinutes || 30;
  const totalDuration = services.reduce((sum, s) => sum + s.duration, 0);
  
  const startMin = timeToMinutes(orgSchedule.start);
  const endMin = timeToMinutes(orgSchedule.end);
  
  const blocks = [];
  
  // Iterar sobre posibles horarios de inicio
  for (let currentMin = startMin; currentMin <= endMin - totalDuration; currentMin += stepMinutes) {
    let blockValid = true;
    const intervals = [];
    
    let slotMin = currentMin;
    
    for (const service of services) {
      const slotStart = minutesToTime(slotMin);
      const slotEnd = minutesToTime(slotMin + service.duration);
      
      // Si tiene empleado asignado
      if (service.employeeId) {
        const employee = allEmployees.find(e => e._id.toString() === service.employeeId);
        if (!employee) {
          blockValid = false;
          break;
        }
        
        // Validar horario del empleado
        const empSchedule = getEmployeeDaySchedule(employee, dayOfWeek, organization);
        if (!empSchedule) {
          blockValid = false;
          break;
        }
        
        // Determinar horario efectivo (intersección org + empleado)
        let effectiveStart = orgSchedule.start;
        let effectiveEnd = orgSchedule.end;
        let effectiveBreaks = [...(orgSchedule.breaks || [])];
        
        if (!empSchedule.useOrgSchedule) {
          const empStartMin = timeToMinutes(empSchedule.start);
          const empEndMin = timeToMinutes(empSchedule.end);
          const orgStartMin = timeToMinutes(effectiveStart);
          const orgEndMin = timeToMinutes(effectiveEnd);
          
          effectiveStart = empStartMin > orgStartMin ? empSchedule.start : effectiveStart;
          effectiveEnd = empEndMin < orgEndMin ? empSchedule.end : effectiveEnd;
          
          // Validar intersección válida
          if (timeToMinutes(effectiveStart) >= timeToMinutes(effectiveEnd)) {
            blockValid = false;
            break;
          }
          
          effectiveBreaks = [...effectiveBreaks, ...(empSchedule.breaks || [])];
        }
        
        // Verificar rango horario
        // El inicio debe estar dentro del rango, el fin puede coincidir exactamente con el cierre
        if (!isTimeInRange(slotStart, effectiveStart, effectiveEnd) ||
            !isTimeInRangeInclusive(slotEnd, effectiveStart, effectiveEnd)) {
          blockValid = false;
          break;
        }
        
        // Verificar breaks (CORREGIDO: ahora verifica todo el slot)
        if (isSlotInBreak(slotStart, service.duration, effectiveBreaks)) {
          blockValid = false;
          break;
        }
        
        // Verificar citas
        const empAppts = appointments.filter(a => 
          a.employee && a.employee.toString() === service.employeeId
        );
        const hasOverlap = empAppts.some(appt => {
          // Convertir las fechas de la cita a la timezone de la organización
          const apptStartInTz = moment.tz(appt.startDate, timezone);
          const apptEndInTz = moment.tz(appt.endDate, timezone);
          
          const apptStart = apptStartInTz.hours() * 60 + apptStartInTz.minutes();
          const apptEnd = apptEndInTz.hours() * 60 + apptEndInTz.minutes();
          return (slotMin < apptEnd && (slotMin + service.duration) > apptStart);
        });
        
        if (hasOverlap) {
          blockValid = false;
          break;
        }
        
        intervals.push({
          serviceId: service.serviceId,
          employeeId: service.employeeId,
          start: slotStart,
          end: slotEnd
        });
        
      } else {
        // Auto-asignar empleado
        const eligibleEmployees = allEmployees.filter(e => 
          e.services && e.services.some(s => s.toString() === service.serviceId)
        );
        
        const assigned = assignBestEmployeeForSlot({
          candidateEmployees: eligibleEmployees,
          date,
          startTime: slotStart,
          duration: service.duration,
          existingAppointments: appointments,
          dayOfWeek,
          organization
        });
        
        if (!assigned) {
          blockValid = false;
          break;
        }
        
        intervals.push({
          serviceId: service.serviceId,
          employeeId: assigned._id.toString(),
          start: slotStart,
          end: slotEnd
        });
      }
      
      slotMin += service.duration;
    }
    
    if (blockValid) {
      // 🔧 FIX: Construir strings ISO sin timezone para que el frontend no tenga que hacer conversiones
      // Formato: "YYYY-MM-DDTHH:mm:ss" sin "Z" ni offset
      const blockStart = `${dateInTz.format('YYYY-MM-DD')}T${minutesToTime(currentMin)}:00`;
      const blockEnd = `${dateInTz.format('YYYY-MM-DD')}T${minutesToTime(slotMin)}:00`;
      
      blocks.push({
        start: blockStart,
        end: blockEnd,
        intervals
      });
    }
  }
  
  // Filtrar bloques pasados si la fecha es hoy
  const nowInTz = moment.tz(timezone);
  const todayStr = nowInTz.format('YYYY-MM-DD');
  const requestDateStr = dateInTz.format('YYYY-MM-DD');
  
  if (todayStr === requestDateStr) {
    // Solo mantener bloques que están en el futuro
    return blocks.filter(block => {
      const blockStartTime = moment.tz(block.start, timezone);
      return blockStartTime.isAfter(nowInTz);
    });
  }
  
  return blocks;
}

/**
 * Verifica disponibilidad de múltiples días para un conjunto de servicios
 * Retorna un objeto con cada día y si tiene al menos un bloque disponible
 * @param {Array<string>} dateStrings - Array de fechas en formato "YYYY-MM-DD"
 * @param {Object} organization - Documento de organización
 * @param {Array} services - Array de servicios [{serviceId, employeeId|null, duration}]
 * @param {Array} allEmployees - Todos los empleados relevantes
 * @param {Array} appointments - Citas existentes del rango de días
 * @returns {Object} { "YYYY-MM-DD": boolean, ... }
 */
function checkMultipleDaysAvailability(dateStrings, organization, services, allEmployees, appointments) {
  const timezone = organization.timezone || 'America/Bogota';
  const result = {};

  for (const dateStr of dateStrings) {
    const dateInTz = moment.tz(dateStr, timezone);
    const dayOfWeek = dateInTz.day();

    // Verificar que la organización esté abierta ese día
    const orgSchedule = getOrganizationDaySchedule(organization, dayOfWeek);
    if (!orgSchedule) {
      result[dateStr] = false;
      continue;
    }

    // Filtrar citas del día específico
    const startOfDay = moment.tz(dateStr, timezone).startOf('day').toDate();
    const endOfDay = moment.tz(dateStr, timezone).endOf('day').toDate();
    const dayAppointments = appointments.filter(a =>
      a.startDate >= startOfDay && a.startDate <= endOfDay
    );

    // Verificar si hay al menos un bloque disponible
    const blocks = findAvailableMultiServiceBlocks(
      dateStr,
      organization,
      services,
      allEmployees,
      dayAppointments
    );

    result[dateStr] = blocks.length > 0;
  }

  return result;
}

export default {
  getDayOfWeekFromDateString,
  timeToMinutes,
  minutesToTime,
  isTimeInRange,
  isTimeInBreak,
  isSlotInBreak,
  getOrganizationDaySchedule,
  getEmployeeDaySchedule,
  validateDateTime,
  generateAvailableSlots,
  getOpenDays,
  getEmployeeAvailableDays,
  isEmployeeAvailableOnDay,
  assignBestEmployeeForSlot,
  findAvailableMultiServiceBlocks,
  checkMultipleDaysAvailability,
};
