/**
 * Endpoint de debug para investigar generación de slots
 * GET /api/schedule/debug-slots?organizationId=xxx&date=2024-12-24&employeeId=xxx&serviceDuration=60
 */

import moment from 'moment-timezone';

export default {
  debugSlots: async (req, res) => {
    const { organizationId, date, employeeId, serviceDuration = 30 } = req.query;
    
    try {
      const debug = {
        input: { organizationId, date, employeeId, serviceDuration },
        steps: []
      };

      // Importar modelos
      const organizationModel = (await import('../models/organizationModel.js')).default;
      const employeeModel = (await import('../models/employeeModel.js')).default;
      const appointmentModel = (await import('../models/appointmentModel.js')).default;
      const scheduleService = (await import('../services/scheduleService.js')).default;

      // 1. Buscar organización
      const organization = await organizationModel.findById(organizationId);
      if (!organization) {
        return res.status(404).json({ error: 'Organización no encontrada' });
      }

      debug.steps.push({
        step: 1,
        name: 'Organización encontrada',
        data: {
          name: organization.name,
          timezone: organization.timezone || 'America/Bogota (default)'
        }
      });

      const timezone = organization.timezone || 'America/Bogota';
      const dayOfWeek = moment.tz(date, timezone).day();

      debug.steps.push({
        step: 2,
        name: 'Fecha parseada',
        data: {
          date,
          timezone,
          dayOfWeek,
          dayName: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][dayOfWeek]
        }
      });

      // 2. Verificar horario del día
      const daySchedule = organization.schedule?.find(s => s.day === dayOfWeek);
      if (!daySchedule) {
        debug.steps.push({
          step: 3,
          name: 'Horario del día',
          error: 'No hay horario configurado para este día'
        });
        return res.json({ debug, message: 'Organización cerrada este día' });
      }

      debug.steps.push({
        step: 3,
        name: 'Horario del día',
        data: {
          start: daySchedule.start,
          end: daySchedule.end,
          breaks: daySchedule.breaks || [],
          startMinutes: parseInt(daySchedule.start.split(':')[0]) * 60 + parseInt(daySchedule.start.split(':')[1]),
          endMinutes: parseInt(daySchedule.end.split(':')[0]) * 60 + parseInt(daySchedule.end.split(':')[1])
        }
      });

      // 3. Buscar empleado si se especificó
      let employee = null;
      let effectiveSchedule = {
        start: daySchedule.start,
        end: daySchedule.end,
        breaks: daySchedule.breaks || []
      };

      if (employeeId) {
        employee = await employeeModel.findById(employeeId);
        if (employee) {
          const empSchedule = employee.schedule?.find(s => s.day === dayOfWeek);
          
          if (empSchedule && !empSchedule.useOrgSchedule) {
            // Calcular horario efectivo (intersección)
            const empStartMin = parseInt(empSchedule.start.split(':')[0]) * 60 + parseInt(empSchedule.start.split(':')[1]);
            const empEndMin = parseInt(empSchedule.end.split(':')[0]) * 60 + parseInt(empSchedule.end.split(':')[1]);
            const orgStartMin = parseInt(daySchedule.start.split(':')[0]) * 60 + parseInt(daySchedule.start.split(':')[1]);
            const orgEndMin = parseInt(daySchedule.end.split(':')[0]) * 60 + parseInt(daySchedule.end.split(':')[1]);
            
            effectiveSchedule.start = empStartMin > orgStartMin ? empSchedule.start : daySchedule.start;
            effectiveSchedule.end = empEndMin < orgEndMin ? empSchedule.end : daySchedule.end;
            effectiveSchedule.breaks = [...daySchedule.breaks || [], ...empSchedule.breaks || []];
          }
          
          debug.steps.push({
            step: 4,
            name: 'Empleado',
            data: {
              name: employee.names,
              hasCustomSchedule: empSchedule && !empSchedule.useOrgSchedule,
              employeeSchedule: empSchedule || 'Usa horario de organización',
              effectiveSchedule: effectiveSchedule,
              warning: (empSchedule && !empSchedule.useOrgSchedule && effectiveSchedule.end !== daySchedule.end) 
                ? `⚠️ El empleado tiene horario limitado hasta ${effectiveSchedule.end} (organización cierra a ${daySchedule.end})`
                : null
            }
          });
        } else {
          debug.steps.push({
            step: 4,
            name: 'Empleado',
            error: 'Empleado no encontrado'
          });
        }
      } else {
        debug.steps.push({
          step: 4,
          name: 'Empleado',
          data: 'No se especificó empleado (se usará horario completo de organización)'
        });
      }

      // 4. Buscar citas del día
      const startOfDay = moment.tz(date, timezone).startOf('day').toDate();
      const endOfDay = moment.tz(date, timezone).endOf('day').toDate();

      const appointments = employeeId 
        ? await appointmentModel.find({
            organizationId,
            employee: employeeId,
            startDate: { $gte: startOfDay, $lte: endOfDay }
          })
        : await appointmentModel.find({
            organizationId,
            startDate: { $gte: startOfDay, $lte: endOfDay }
          });

      debug.steps.push({
        step: 5,
        name: 'Citas del día',
        data: {
          total: appointments.length,
          appointments: appointments.map(a => ({
            start: moment.tz(a.startDate, timezone).format('HH:mm'),
            end: moment.tz(a.endDate, timezone).format('HH:mm'),
            employeeName: a.employee?.names || 'Sin empleado'
          }))
        }
      });

      // 5. Generar slots
      const slots = scheduleService.generateAvailableSlots(
        date,
        organization,
        employee,
        parseInt(serviceDuration),
        appointments
      );

      const availableSlots = slots.filter(s => s.available);
      const firstAvailable = availableSlots[0];
      const lastAvailable = availableSlots[availableSlots.length - 1];

      debug.steps.push({
        step: 6,
        name: 'Slots generados',
        data: {
          totalSlots: slots.length,
          availableSlots: availableSlots.length,
          occupiedSlots: slots.length - availableSlots.length,
          firstSlot: slots[0]?.time,
          lastSlot: slots[slots.length - 1]?.time,
          firstAvailable: firstAvailable?.time,
          lastAvailable: lastAvailable?.time,
          allSlots: slots.map(s => ({
            time: s.time,
            available: s.available
          }))
        }
      });

      // 6. Análisis
      const expectedLastSlot = daySchedule.end;
      const actualLastSlot = slots[slots.length - 1]?.time;
      
      debug.analysis = {
        expectedLastSlotTime: expectedLastSlot,
        actualLastSlotTime: actualLastSlot,
        match: expectedLastSlot === actualLastSlot || 
               parseInt(actualLastSlot?.split(':')[0]) * 60 + parseInt(actualLastSlot?.split(':')[1] || 0) >= 
               parseInt(expectedLastSlot.split(':')[0]) * 60 + parseInt(expectedLastSlot.split(':')[1]) - parseInt(serviceDuration),
        issue: actualLastSlot !== expectedLastSlot ? 
          `El último slot debería estar cerca de ${expectedLastSlot} pero es ${actualLastSlot}` : null
      };

      return res.json(debug);

    } catch (error) {
      return res.status(500).json({ 
        error: error.message,
        stack: error.stack 
      });
    }
  }
};
