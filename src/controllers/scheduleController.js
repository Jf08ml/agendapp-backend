/**
 * Controller para gestionar horarios de disponibilidad
 * Maneja tanto horarios de organización como de empleados
 */

import moment from 'moment-timezone';
import organizationModel from "../models/organizationModel.js";
import employeeModel from "../models/employeeModel.js";
import appointmentModel from "../models/appointmentModel.js";
import serviceModel from "../models/serviceModel.js";
import scheduleService from "../services/scheduleService.js";
import sendResponse from "../utils/sendResponse.js";

const scheduleController = {
  /**
   * Actualizar horario semanal de la organización
   * PUT /api/schedule/organization/:orgId
   */
  updateOrganizationSchedule: async (req, res) => {
    const { orgId } = req.params;
    const { enabled, schedule, stepMinutes } = req.body;

    try {
      const organization = await organizationModel.findById(orgId);
      if (!organization) {
        return sendResponse(res, 404, null, "Organización no encontrada");
      }

      // Validar estructura del horario
      if (schedule) {
        if (!Array.isArray(schedule) || schedule.length !== 7) {
          return sendResponse(
            res,
            400,
            null,
            "El horario debe contener 7 días (0-6)"
          );
        }

        // Validar cada día
        for (const daySchedule of schedule) {
          if (daySchedule.day < 0 || daySchedule.day > 6) {
            return sendResponse(
              res,
              400,
              null,
              "Los días deben estar entre 0 (Domingo) y 6 (Sábado)"
            );
          }

          if (daySchedule.isOpen) {
            if (!daySchedule.start || !daySchedule.end) {
              return sendResponse(
                res,
                400,
                null,
                `El día ${daySchedule.day} está marcado como abierto pero falta horario`
              );
            }

            // Validar formato de hora
            const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
            if (
              !timeRegex.test(daySchedule.start) ||
              !timeRegex.test(daySchedule.end)
            ) {
              return sendResponse(
                res,
                400,
                null,
                "El formato de hora debe ser HH:mm"
              );
            }

            // Validar que el inicio sea antes del fin
            if (
              scheduleService.timeToMinutes(daySchedule.start) >=
              scheduleService.timeToMinutes(daySchedule.end)
            ) {
              return sendResponse(
                res,
                400,
                null,
                `El horario de inicio debe ser antes del fin en el día ${daySchedule.day}`
              );
            }
          }
        }
      }

      // Actualizar
      organization.weeklySchedule = {
        enabled: enabled !== undefined ? enabled : organization.weeklySchedule?.enabled || false,
        schedule: schedule || organization.weeklySchedule?.schedule || [],
        stepMinutes: stepMinutes || organization.weeklySchedule?.stepMinutes || 30,
      };

      await organization.save();

      return sendResponse(
        res,
        200,
        organization.weeklySchedule,
        "Horario de organización actualizado exitosamente"
      );
    } catch (error) {
      return sendResponse(
        res,
        500,
        null,
        `Error al actualizar horario: ${error.message}`
      );
    }
  },

  /**
   * Obtener horario semanal de la organización
   * GET /api/schedule/organization/:orgId
   */
  getOrganizationSchedule: async (req, res) => {
    const { orgId } = req.params;

    try {
      const organization = await organizationModel.findById(orgId);
      if (!organization) {
        return sendResponse(res, 404, null, "Organización no encontrada");
      }

      return sendResponse(
        res,
        200,
        organization.weeklySchedule || { enabled: false, schedule: [] },
        "Horario obtenido exitosamente"
      );
    } catch (error) {
      return sendResponse(
        res,
        500,
        null,
        `Error al obtener horario: ${error.message}`
      );
    }
  },

  /**
   * Actualizar horario semanal de un empleado
   * PUT /api/schedule/employee/:employeeId
   */
  updateEmployeeSchedule: async (req, res) => {
    const { employeeId } = req.params;
    const { enabled, schedule } = req.body;

    try {
      const employee = await employeeModel.findById(employeeId);
      if (!employee) {
        return sendResponse(res, 404, null, "Empleado no encontrado");
      }

      // Validar estructura del horario (similar a organización)
      if (schedule) {
        if (!Array.isArray(schedule) || schedule.length !== 7) {
          return sendResponse(
            res,
            400,
            null,
            "El horario debe contener 7 días (0-6)"
          );
        }

        for (const daySchedule of schedule) {
          if (daySchedule.day < 0 || daySchedule.day > 6) {
            return sendResponse(
              res,
              400,
              null,
              "Los días deben estar entre 0 (Domingo) y 6 (Sábado)"
            );
          }

          if (daySchedule.isAvailable) {
            if (!daySchedule.start || !daySchedule.end) {
              return sendResponse(
                res,
                400,
                null,
                `El día ${daySchedule.day} está marcado como disponible pero falta horario`
              );
            }

            const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
            if (
              !timeRegex.test(daySchedule.start) ||
              !timeRegex.test(daySchedule.end)
            ) {
              return sendResponse(
                res,
                400,
                null,
                "El formato de hora debe ser HH:mm"
              );
            }

            if (
              scheduleService.timeToMinutes(daySchedule.start) >=
              scheduleService.timeToMinutes(daySchedule.end)
            ) {
              return sendResponse(
                res,
                400,
                null,
                `El horario de inicio debe ser antes del fin en el día ${daySchedule.day}`
              );
            }
          }
        }
      }

      // Actualizar
      employee.weeklySchedule = {
        enabled: enabled !== undefined ? enabled : employee.weeklySchedule?.enabled || false,
        schedule: schedule || employee.weeklySchedule?.schedule || [],
      };

      await employee.save();

      return sendResponse(
        res,
        200,
        employee.weeklySchedule,
        "Horario del empleado actualizado exitosamente"
      );
    } catch (error) {
      return sendResponse(
        res,
        500,
        null,
        `Error al actualizar horario: ${error.message}`
      );
    }
  },

  /**
   * Obtener horario semanal de un empleado
   * GET /api/schedule/employee/:employeeId
   */
  getEmployeeSchedule: async (req, res) => {
    const { employeeId } = req.params;

    try {
      const employee = await employeeModel.findById(employeeId);
      if (!employee) {
        return sendResponse(res, 404, null, "Empleado no encontrado");
      }

      return sendResponse(
        res,
        200,
        employee.weeklySchedule || { enabled: false, schedule: [] },
        "Horario obtenido exitosamente"
      );
    } catch (error) {
      return sendResponse(
        res,
        500,
        null,
        `Error al obtener horario: ${error.message}`
      );
    }
  },

  /**
   * Obtener slots de tiempo disponibles para un día y empleado específico
   * POST /api/schedule/available-slots
   */
  getAvailableSlots: async (req, res) => {
    const { date, organizationId, employeeId, serviceDuration } = req.body;

    try {
      if (!date || !organizationId) {
        return sendResponse(
          res,
          400,
          null,
          "Fecha y organización son requeridos"
        );
      }

      const organization = await organizationModel.findById(organizationId);
      if (!organization) {
        return sendResponse(res, 404, null, "Organización no encontrada");
      }

      let employee = null;
      if (employeeId) {
        employee = await employeeModel.findById(employeeId);
        if (!employee) {
          return sendResponse(res, 404, null, "Empleado no encontrado");
        }
      }

      // Usar la zona horaria de la organización
      const timezone = organization.timezone || 'America/Bogota';
      const duration = serviceDuration || 30;

      // Obtener citas del día para filtrar slots ocupados
      // Usar moment para asegurar que los rangos de día sean correctos en la zona horaria
      const startOfDay = moment.tz(date, timezone).startOf('day').toDate();
      const endOfDay = moment.tz(date, timezone).endOf('day').toDate();

      // Si hay empleado específico, solo sus citas
      // Si no, cargar todas las citas de la organización para ese día
      // ✅ EXCLUIR citas canceladas para que sus slots estén disponibles
      const appointmentQuery = {
        organizationId,
        startDate: { $gte: startOfDay, $lte: endOfDay },
        status: { $nin: ['cancelled_by_customer', 'cancelled_by_admin'] } // ✅ Excluir canceladas
      };

      if (employeeId) {
        appointmentQuery.employee = employeeId;
      }

      const appointments = await appointmentModel.find(appointmentQuery);

      // 👥 Si se proporciona serviceId, obtener maxConcurrentAppointments del servicio
      let maxConcurrentAppointments = 1;
      const { serviceId } = req.body;
      if (serviceId) {
        const service = await serviceModel.findById(serviceId);
        if (service) {
          maxConcurrentAppointments = service.maxConcurrentAppointments ?? 1;
        }
      }

      const slots = scheduleService.generateAvailableSlots(
        date, // Pasar el string de fecha
        organization,
        employee,
        duration,
        appointments,
        maxConcurrentAppointments
      );
      appointments.forEach(appt => {
        const start = moment.tz(appt.startDate, timezone);
        const end = moment.tz(appt.endDate, timezone);
      });

      return sendResponse(
        res,
        200,
        { date, slots, totalSlots: slots.length },
        "Slots disponibles obtenidos exitosamente"
      );
    } catch (error) {
      return sendResponse(
        res,
        500,
        null,
        `Error al obtener slots disponibles: ${error.message}`
      );
    }
  },

  /**
   * Validar si una fecha/hora específica está disponible
   * POST /api/schedule/validate-datetime
   */
  validateDateTime: async (req, res) => {
    const { datetime, organizationId, employeeId } = req.body;

    try {
      if (!datetime || !organizationId) {
        return sendResponse(
          res,
          400,
          null,
          "Fecha/hora y organización son requeridos"
        );
      }

      const organization = await organizationModel.findById(organizationId);
      if (!organization) {
        return sendResponse(res, 404, null, "Organización no encontrada");
      }

      let employee = null;
      if (employeeId) {
        employee = await employeeModel.findById(employeeId);
        if (!employee) {
          return sendResponse(res, 404, null, "Empleado no encontrado");
        }
      }

      const requestedDateTime = new Date(datetime);
      const validation = scheduleService.validateDateTime(
        requestedDateTime,
        organization,
        employee
      );

      return sendResponse(
        res,
        200,
        validation,
        validation.valid
          ? "Horario válido"
          : "Horario no válido"
      );
    } catch (error) {
      return sendResponse(
        res,
        500,
        null,
        `Error al validar horario: ${error.message}`
      );
    }
  },

  /**
   * Obtener días abiertos de una organización
   * GET /api/schedule/organization/:orgId/open-days
   */
  getOpenDays: async (req, res) => {
    const { orgId } = req.params;

    try {
      const organization = await organizationModel.findById(orgId);
      if (!organization) {
        return sendResponse(res, 404, null, "Organización no encontrada");
      }

      const openDays = scheduleService.getOpenDays(organization);

      return sendResponse(
        res,
        200,
        { openDays },
        "Días abiertos obtenidos exitosamente"
      );
    } catch (error) {
      return sendResponse(
        res,
        500,
        null,
        `Error al obtener días abiertos: ${error.message}`
      );
    }
  },

  /**
   * Obtener días disponibles de un empleado
   * GET /api/schedule/employee/:employeeId/available-days
   */
  getEmployeeAvailableDays: async (req, res) => {
    const { employeeId } = req.params;

    try {
      const employee = await employeeModel
        .findById(employeeId)
        .populate("organizationId");

      if (!employee) {
        return sendResponse(res, 404, null, "Empleado no encontrado");
      }

      const availableDays = scheduleService.getEmployeeAvailableDays(
        employee,
        employee.organizationId
      );

      return sendResponse(
        res,
        200,
        { availableDays },
        "Días disponibles obtenidos exitosamente"
      );
    } catch (error) {
      return sendResponse(
        res,
        500,
        null,
        `Error al obtener días disponibles: ${error.message}`
      );
    }
  },

  /**
   * Obtener bloques de tiempo disponibles para múltiples servicios (mismo día)
   * POST /api/schedule/multi-service-blocks
   * Body: { date, organizationId, services: [{serviceId, employeeId|null, duration}] }
   */
  getMultiServiceBlocks: async (req, res) => {
    const { date, organizationId, services } = req.body;
    
    try {
      // Validar parámetros
      if (!date || !organizationId || !services || !Array.isArray(services)) {
        return sendResponse(res, 400, null, "Parámetros inválidos");
      }
      
      if (services.length === 0) {
        return sendResponse(res, 400, null, "Debe proporcionar al menos un servicio");
      }
      
      // Obtener organización
      const organization = await organizationModel.findById(organizationId);
      if (!organization) {
        return sendResponse(res, 404, null, "Organización no encontrada");
      }
      
      // Obtener día de la semana de la fecha solicitada
      // Usar helper para evitar problemas de zona horaria
      const timezone = organization.timezone || 'America/Bogota';
      const dayOfWeek = scheduleService.getDayOfWeekFromDateString(date, timezone);
      
      // Verificar que la organización esté abierta ese día
      const orgSchedule = scheduleService.getOrganizationDaySchedule(organization, dayOfWeek);
      if (!orgSchedule) {
        return sendResponse(res, 200, { blocks: [] }, "La organización está cerrada ese día");
      }

      // Verificar si es un festivo bloqueado para reservas online
      if (scheduleService.isBlockedHoliday(date, organization)) {
        return sendResponse(res, 200, { blocks: [] }, "Día festivo bloqueado para reservas");
      }

      // Obtener empleados necesarios
      const allEmployeeIds = new Set();
      for (const svc of services) {
        if (svc.employeeId) {
          allEmployeeIds.add(svc.employeeId);
        } else {
          // Obtener empleados elegibles para este servicio
          const eligible = await employeeModel.find({
            organizationId,
            isActive: true,
            services: svc.serviceId
          });
          eligible.forEach(e => allEmployeeIds.add(e._id.toString()));
        }
      }
      
      const allEmployees = await employeeModel.find({
        _id: { $in: Array.from(allEmployeeIds) }
      });
      
      // Filtrar solo los empleados disponibles ese día
      const employees = allEmployees.filter(emp => 
        scheduleService.isEmployeeAvailableOnDay(emp, dayOfWeek, organization)
      );
      
      if (employees.length === 0) {
        return sendResponse(res, 200, { blocks: [] }, "No hay empleados disponibles ese día");
      }
      
      // Obtener citas existentes del día (solo de empleados disponibles)
      const availableEmployeeIds = employees.map(e => e._id);
      const startOfDay = moment.tz(date, timezone).startOf('day').toDate();
      const endOfDay = moment.tz(date, timezone).endOf('day').toDate();
      
      // ✅ EXCLUIR citas canceladas para que sus slots estén disponibles
      const appointments = await appointmentModel.find({
        organizationId,
        employee: { $in: availableEmployeeIds },
        startDate: { $gte: startOfDay, $lte: endOfDay },
        status: { $nin: ['cancelled_by_customer', 'cancelled_by_admin'] } // ✅ Excluir canceladas
      });
      
      // Obtener maxConcurrentAppointments de cada servicio
      const serviceIds = [...new Set(services.map(s => s.serviceId).filter(Boolean))];
      const serviceModels = serviceIds.length > 0
        ? await serviceModel.find({ _id: { $in: serviceIds } })
        : [];
      const servicesModelMap = new Map(serviceModels.map(s => [s._id.toString(), s]));
      const servicesEnriched = services.map(s => ({
        ...s,
        maxConcurrentAppointments: servicesModelMap.get(s.serviceId)?.maxConcurrentAppointments ?? 1
      }));

      // Calcular bloques disponibles
      const blocks = scheduleService.findAvailableMultiServiceBlocks(
        date, // Pasar el string de fecha
        organization,
        servicesEnriched,
        employees,
        appointments
      );

      console.log("Bloques disponibles calculados:", blocks);
      
      return sendResponse(res, 200, { blocks }, "Bloques obtenidos exitosamente");
      
    } catch (error) {
      return sendResponse(res, 500, null, `Error: ${error.message}`);
    }
  },

  /**
   * Obtener slots disponibles para múltiples servicios/días (batch optimizado)
   * POST /api/schedule/available-slots-batch
   * Body: { organizationId, requests: [{date, serviceId, employeeId|null, duration}] }
   */
  getAvailableSlotsBatch: async (req, res) => {
    const { organizationId, requests } = req.body;
    
    try {
      // Validar parámetros
      if (!organizationId || !requests || !Array.isArray(requests)) {
        return sendResponse(res, 400, null, "Parámetros inválidos");
      }
      
      if (requests.length === 0) {
        return sendResponse(res, 400, null, "Debe proporcionar al menos una solicitud");
      }
      
      // Obtener organización
      const organization = await organizationModel.findById(organizationId);
      if (!organization) {
        return sendResponse(res, 404, null, "Organización no encontrada");
      }
      
      // Recolectar todos los empleados únicos necesarios
      const allEmployeeIds = new Set();
      for (const req of requests) {
        if (req.employeeId) {
          allEmployeeIds.add(req.employeeId);
        } else if (req.serviceId) {
          // Obtener empleados elegibles para este servicio
          const eligible = await employeeModel.find({
            organizationId,
            isActive: true,
            services: req.serviceId
          });
          eligible.forEach(e => allEmployeeIds.add(e._id.toString()));
        }
      }
      
      // Obtener todos los servicios únicos necesarios para maxConcurrentAppointments
      const serviceIds = new Set(requests.map(r => r.serviceId).filter(Boolean));
      const services = serviceIds.size > 0 
        ? await serviceModel.find({ _id: { $in: Array.from(serviceIds) } })
        : [];
      const servicesMap = new Map(services.map(s => [s._id.toString(), s]));
      
      const employees = await employeeModel.find({
        _id: { $in: Array.from(allEmployeeIds) }
      });
      
      // Crear un mapa de empleados disponibles por día
      const employeesByDay = new Map();
      for (const req of requests) {
        // Usar helper para obtener día de la semana sin problemas de zona horaria
        const dayOfWeek = scheduleService.getDayOfWeekFromDateString(req.date);
        const key = `${req.date}_${req.serviceId}`;
        
        // Filtrar empleados disponibles ese día
        const availableEmps = employees.filter(emp => {
          // Si el request tiene employeeId específico, verificar solo ese
          if (req.employeeId && emp._id.toString() !== req.employeeId) return false;
          // Verificar que tenga el servicio
          if (req.serviceId && !emp.services.some(s => s.toString() === req.serviceId)) return false;
          // Verificar disponibilidad del día
          return scheduleService.isEmployeeAvailableOnDay(emp, dayOfWeek, organization);
        });
        
        employeesByDay.set(key, availableEmps);
      }
      
      // Obtener rango de fechas para consulta de citas
      const timezone = organization.timezone || 'America/Bogota';
      const parsedDates = requests.map(r => moment.tz(r.date, timezone).toDate());
      const minDate = moment.tz(
        moment.tz(Math.min(...parsedDates.map(d => d.getTime())), timezone).format('YYYY-MM-DD'),
        timezone
      ).startOf('day').toDate();
      
      const maxDate = moment.tz(
        moment.tz(Math.max(...parsedDates.map(d => d.getTime())), timezone).format('YYYY-MM-DD'),
        timezone
      ).endOf('day').toDate();
      
      // Obtener todas las citas en el rango de una sola vez
      // ✅ EXCLUIR citas canceladas para que sus slots estén disponibles
      const appointments = await appointmentModel.find({
        organizationId,
        employee: { $in: Array.from(allEmployeeIds) },
        startDate: { $gte: minDate, $lte: maxDate },
        status: { $nin: ['cancelled_by_customer', 'cancelled_by_admin'] } // ✅ Excluir canceladas
      });
      
      // Procesar cada solicitud
      const results = [];
      
      for (const request of requests) {
        // Parsear la fecha usando moment-timezone con la zona horaria de la organización
        const requestDate = moment.tz(request.date, timezone).toDate();
        const startOfDay = moment.tz(request.date, timezone).startOf('day').toDate();
        const endOfDay = moment.tz(request.date, timezone).endOf('day').toDate();
        
        // Filtrar citas del día
        const dayAppointments = appointments.filter(a => 
          a.startDate >= startOfDay && a.startDate <= endOfDay
        );
        
        let slots = [];
        
        const key = `${request.date}_${request.serviceId}`;
        const eligibleEmployees = employeesByDay.get(key) || [];
        
        if (eligibleEmployees.length === 0) {
          // No hay empleados disponibles ese día
          results.push({
            serviceId: request.serviceId,
            employeeId: request.employeeId || null,
            date: request.date,
            slots: []
          });
          continue;
        }
        
        if (request.employeeId) {
          // Empleado específico
          const employee = eligibleEmployees.find(e => e._id.toString() === request.employeeId);
          if (employee) {
            const service = servicesMap.get(request.serviceId);
            const maxConcurrent = service?.maxConcurrentAppointments ?? 1;
            const generatedSlots = scheduleService.generateAvailableSlots(
              requestDate,
              organization,
              employee,
              request.duration || 30,
              dayAppointments,
              maxConcurrent
            );
            slots = generatedSlots.filter(s => s.available).map(s => s.time);
          }
        } else {
          // Auto-asignar: obtener slots de todos los empleados elegibles
          const timeSet = new Set();
          const service = servicesMap.get(request.serviceId);
          const maxConcurrent = service?.maxConcurrentAppointments ?? 1;
          for (const emp of eligibleEmployees) {
            const generatedSlots = scheduleService.generateAvailableSlots(
              requestDate,
              organization,
              emp,
              request.duration || 30,
              dayAppointments,
              maxConcurrent
            );
            generatedSlots.filter(s => s.available).forEach(s => timeSet.add(s.time));
          }
          
          slots = Array.from(timeSet).sort();
        }
        
        results.push({
          serviceId: request.serviceId,
          employeeId: request.employeeId || null,
          date: request.date,
          slots
        });
      }
      
      return sendResponse(res, 200, { results }, "Slots obtenidos exitosamente");
      
    } catch (error) {
      return sendResponse(res, 500, null, `Error: ${error.message}`);
    }
  },

  /**
   * Verificar disponibilidad de múltiples días para un conjunto de servicios
   * POST /api/schedule/check-days-availability
   * Body: { organizationId, services: [{serviceId, employeeId|null, duration}], startDate, endDate }
   * Returns: { availability: { "YYYY-MM-DD": boolean, ... } }
   */
  checkDaysAvailability: async (req, res) => {
    const { organizationId, services, startDate, endDate } = req.body;

    try {
      // Validar parámetros
      if (!organizationId || !services || !Array.isArray(services) || !startDate || !endDate) {
        return sendResponse(res, 400, null, "Parámetros inválidos");
      }

      if (services.length === 0) {
        return sendResponse(res, 400, null, "Debe proporcionar al menos un servicio");
      }

      // Obtener organización
      const organization = await organizationModel.findById(organizationId);
      if (!organization) {
        return sendResponse(res, 404, null, "Organización no encontrada");
      }

      const timezone = organization.timezone || 'America/Bogota';

      // Generar array de fechas entre startDate y endDate
      const dateStrings = [];
      let current = moment.tz(startDate, timezone);
      const end = moment.tz(endDate, timezone);

      while (current.isSameOrBefore(end, 'day')) {
        dateStrings.push(current.format('YYYY-MM-DD'));
        current.add(1, 'day');
      }

      // Limitar a máximo 60 días para evitar consultas muy pesadas
      if (dateStrings.length > 60) {
        return sendResponse(res, 400, null, "El rango máximo es de 60 días");
      }

      // Obtener empleados necesarios
      const allEmployeeIds = new Set();
      for (const svc of services) {
        if (svc.employeeId) {
          allEmployeeIds.add(svc.employeeId);
        } else {
          // Obtener empleados elegibles para este servicio
          const eligible = await employeeModel.find({
            organizationId,
            isActive: true,
            services: svc.serviceId
          });
          eligible.forEach(e => allEmployeeIds.add(e._id.toString()));
        }
      }

      const allEmployees = await employeeModel.find({
        _id: { $in: Array.from(allEmployeeIds) }
      });

      if (allEmployees.length === 0) {
        // Si no hay empleados, todos los días están sin disponibilidad
        const availability = {};
        dateStrings.forEach(d => { availability[d] = false; });
        return sendResponse(res, 200, { availability }, "Sin empleados disponibles");
      }

      // Obtener todas las citas en el rango
      const rangeStart = moment.tz(startDate, timezone).startOf('day').toDate();
      const rangeEnd = moment.tz(endDate, timezone).endOf('day').toDate();

      const appointments = await appointmentModel.find({
        organizationId,
        employee: { $in: Array.from(allEmployeeIds) },
        startDate: { $gte: rangeStart, $lte: rangeEnd },
        status: { $nin: ['cancelled_by_customer', 'cancelled_by_admin'] }
      });

      // Obtener maxConcurrentAppointments de cada servicio
      const serviceIdsForCheck = [...new Set(services.map(s => s.serviceId).filter(Boolean))];
      const serviceModelsForCheck = serviceIdsForCheck.length > 0
        ? await serviceModel.find({ _id: { $in: serviceIdsForCheck } })
        : [];
      const servicesModelMapForCheck = new Map(serviceModelsForCheck.map(s => [s._id.toString(), s]));
      const servicesEnrichedForCheck = services.map(s => ({
        ...s,
        maxConcurrentAppointments: servicesModelMapForCheck.get(s.serviceId)?.maxConcurrentAppointments ?? 1
      }));

      // Verificar disponibilidad de cada día
      const availability = scheduleService.checkMultipleDaysAvailability(
        dateStrings,
        organization,
        servicesEnrichedForCheck,
        allEmployees,
        appointments
      );

      return sendResponse(res, 200, { availability }, "Disponibilidad obtenida exitosamente");

    } catch (error) {
      return sendResponse(res, 500, null, `Error: ${error.message}`);
    }
  },

  /**
   * Obtener excepciones de horario de un empleado
   * GET /api/schedule/employee/:employeeId/exceptions
   */
  getEmployeeExceptions: async (req, res) => {
    const { employeeId } = req.params;
    try {
      const employee = await employeeModel.findById(employeeId);
      if (!employee) {
        return sendResponse(res, 404, null, "Empleado no encontrado");
      }
      return sendResponse(res, 200, employee.scheduleExceptions || [], "Excepciones obtenidas exitosamente");
    } catch (error) {
      return sendResponse(res, 500, null, `Error: ${error.message}`);
    }
  },

  /**
   * Agregar excepción de horario a un empleado
   * POST /api/schedule/employee/:employeeId/exceptions
   */
  addEmployeeException: async (req, res) => {
    const { employeeId } = req.params;
    const { startDate, endDate, allDay, startTime, endTime, reason } = req.body;

    try {
      if (!startDate || !endDate) {
        return sendResponse(res, 400, null, "startDate y endDate son requeridos");
      }

      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
        return sendResponse(res, 400, null, "El formato de fecha debe ser YYYY-MM-DD");
      }

      if (startDate > endDate) {
        return sendResponse(res, 400, null, "La fecha de inicio debe ser anterior o igual a la fecha de fin");
      }

      if (!allDay) {
        if (!startTime || !endTime) {
          return sendResponse(res, 400, null, "startTime y endTime son requeridos cuando allDay es false");
        }
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
          return sendResponse(res, 400, null, "El formato de hora debe ser HH:mm");
        }
        if (scheduleService.timeToMinutes(startTime) >= scheduleService.timeToMinutes(endTime)) {
          return sendResponse(res, 400, null, "La hora de inicio debe ser anterior a la hora de fin");
        }
      }

      const employee = await employeeModel.findById(employeeId);
      if (!employee) {
        return sendResponse(res, 404, null, "Empleado no encontrado");
      }

      const newException = {
        startDate,
        endDate,
        allDay: allDay !== false,
        ...((!allDay && startTime && endTime) ? { startTime, endTime } : {}),
        ...(reason ? { reason } : {}),
        createdAt: new Date(),
      };

      employee.scheduleExceptions.push(newException);
      await employee.save();

      return sendResponse(res, 201, employee.scheduleExceptions, "Excepción agregada exitosamente");
    } catch (error) {
      return sendResponse(res, 500, null, `Error: ${error.message}`);
    }
  },

  /**
   * Eliminar excepción de horario de un empleado
   * DELETE /api/schedule/employee/:employeeId/exceptions/:exceptionId
   */
  removeEmployeeException: async (req, res) => {
    const { employeeId, exceptionId } = req.params;
    try {
      const employee = await employeeModel.findById(employeeId);
      if (!employee) {
        return sendResponse(res, 404, null, "Empleado no encontrado");
      }

      const initialLength = employee.scheduleExceptions.length;
      employee.scheduleExceptions = employee.scheduleExceptions.filter(
        (e) => e._id.toString() !== exceptionId
      );

      if (employee.scheduleExceptions.length === initialLength) {
        return sendResponse(res, 404, null, "Excepción no encontrada");
      }

      await employee.save();
      return sendResponse(res, 200, employee.scheduleExceptions, "Excepción eliminada exitosamente");
    } catch (error) {
      return sendResponse(res, 500, null, `Error: ${error.message}`);
    }
  },
};

export default scheduleController;
