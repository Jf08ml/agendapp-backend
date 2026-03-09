import appointmentModel from "../models/appointmentModel.js";
import organizationService from "./organizationService.js";
import membershipService from "./membershipService.js";
import serviceService from "./serviceService.js";
import whatsappService from "./sendWhatsappService.js";
import whatsappTemplates from "../utils/whatsappTemplates.js";
import WhatsappTemplate from "../models/whatsappTemplateModel.js";
import clientService from "../services/clientService.js";
import employeeService from "../services/employeeService.js";
import { waIntegrationService } from "../services/waIntegrationService.js";
import cancellationService from "./cancellationService.js";
import packageService from "./packageService.js";
import { generateCancellationLink } from "../utils/cancellationUtils.js";
import notificationService from "./notificationService.js";
import mongoose from "mongoose";
import moment from "moment-timezone";

// Utilidades mínimas (si ya las tienes, quítalas de aquí)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Obtiene el inicio y fin de "hoy" en Bogotá, en UTC.
 * Bogotá no tiene DST: offset fijo UTC-5.
 */
function getBogotaTodayWindowUTC(baseDate = new Date()) {
  // “Fecha hoy” en Bogotá
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(baseDate);

  const y = Number(parts.find((p) => p.type === "year").value);
  const m = Number(parts.find((p) => p.type === "month").value) - 1; // 0-11
  const d = Number(parts.find((p) => p.type === "day").value);

  // 00:00 Bogotá -> 05:00 UTC del mismo día
  const dayStartUTC = new Date(Date.UTC(y, m, d, 5, 0, 0, 0));
  // 23:59:59.999 Bogotá -> 04:59:59.999 UTC del día siguiente
  const dayEndUTC = new Date(Date.UTC(y, m, d + 1, 4, 59, 59, 999));
  return { dayStartUTC, dayEndUTC };
}

// Helpers de formato (añádelos arriba, cerca de getBogotaTodayWindowUTC)
// 🔧 FIX: Helpers de formato que aceptan timezone dinámico
const fmt = (d, tz = "America/Bogota", timeFormat = '12h') =>
  new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: timeFormat !== '24h',
    timeZone: tz,
  }).format(new Date(d));

const fmtTime = (d, tz = "America/Bogota", timeFormat = '12h') =>
  new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: timeFormat !== '24h',
    timeZone: tz,
  }).format(new Date(d));

const appointmentService = {
  // Crear una nueva cita
  createAppointment: async (appointmentData) => {
    const {
      service,
      employee,
      employeeRequestedByClient,
      client,
      startDate,
      endDate,
      organizationId,
      advancePayment,
      customPrice,
      additionalItems = [],
    } = appointmentData;

    // Obtener detalles de la organización para timezone
    const organization = await organizationService.getOrganizationById(
      organizationId
    );
    if (!organization) {
      throw new Error("Organización no encontrada");
    }

    const timezone = organization.timezone || 'America/Bogota';

    // 🔧 FIX: Interpretar fechas explícitamente en la zona horaria de la organización
    // El string viene formato "YYYY-MM-DDTHH:mm:ss" y representa tiempo LOCAL en la timezone de la org
    // IMPORTANTE: Usar moment.tz() con 3 parámetros para que interprete el string como tiempo LOCAL
    console.log('🔍 DEBUG TIMEZONE:', {
      startDate,
      timezone,
      momentParsed: moment.tz(startDate, 'YYYY-MM-DDTHH:mm:ss', timezone).format(),
      toDate: moment.tz(startDate, 'YYYY-MM-DDTHH:mm:ss', timezone).toDate()
    });
    const parsedStartDate = moment.tz(startDate, 'YYYY-MM-DDTHH:mm:ss', timezone).toDate();
    const parsedEndDate = moment.tz(endDate, 'YYYY-MM-DDTHH:mm:ss', timezone).toDate();

    // Comprobar citas superpuestas
    // const overlappingAppointments = await appointmentModel.find({
    //   employee,
    //   $or: [
    //     { startDate: { $lt: parsedEndDate, $gte: parsedStartDate } },
    //     { endDate: { $gt: parsedStartDate, $lte: parsedEndDate } },
    //     { startDate: { $lte: parsedStartDate }, endDate: { $gte: parsedEndDate } },
    //   ],
    // });

    // if (overlappingAppointments.length > 0) {
    //   throw new Error("El empleado tiene citas que se cruzan");
    // }

    // Validar adicionales (opcional)
    additionalItems.forEach((item) => {
      if (!item.name || !item.price || item.price < 0 || item.quantity < 0) {
        throw new Error("Adicionales inválidos en la cita");
      }
    });

    // Obtener el servicio para el precio base
    const serviceDetails = await serviceService.getServiceById(service);
    if (!serviceDetails) {
      throw new Error("Servicio no encontrado");
    }

    const basePrice = customPrice ?? serviceDetails.price; // Usar precio personalizado o el del servicio
    const additionalCost = additionalItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    const totalPrice = basePrice + additionalCost; // Calcular precio total

    // 🔗 Generar token de cancelación
    const { token: cancelToken, hash: cancelTokenHash } = cancellationService.generateCancelToken();

    // 🔗 Generar enlace público (usará el mismo token para confirmar/cancelar)
    const cancellationLink = generateCancellationLink(cancelToken, organization);
    
    console.log('🔑 Token generado para appointment:', {
      token: cancelToken,
      hash: cancelTokenHash.substring(0, 20) + '...',
    });

    // Crear la cita con las fechas parseadas
    const newAppointment = new appointmentModel({
      service,
      employee,
      employeeRequestedByClient,
      client,
      startDate: parsedStartDate,
      endDate: parsedEndDate,
      organizationId,
      advancePayment,
      customPrice,
      additionalItems,
      totalPrice, // Asignar precio total calculado
      cancelTokenHash, // 🔗 Guardar hash del token
      cancellationLink,
    });

    // Formatear fecha para la confirmación
    const appointmentDate = new Intl.DateTimeFormat("es-ES", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: (organization.timeFormat || '12h') !== '24h',
      timeZone: timezone,
    }).format(parsedStartDate);

    const appointmentDetails = {
      names: client?.name || "Estimado cliente",
      date: appointmentDate,
      organization: organization.name,
      address: organization.address || "",
      service: serviceDetails.name,
      employee: employee.names,
      phoneNumber: organization.phoneNumber,
    };

    // Enviar confirmación por WhatsApp (solo si está habilitado)
    try {
      // Verificar si el plan permite confirmaciones automáticas
      const planLimits = await membershipService.getPlanLimits(organizationId);
      if (planLimits && planLimits.autoConfirmations === false) {
        console.log(`⏭️  Confirmación bloqueada por plan para org ${organizationId}`);
      } else {
      // 🆕 Verificar si el envío de confirmación está habilitado
      const whatsappTemplate = await WhatsappTemplate.findOne({ organizationId });
      const isConfirmationEnabled = whatsappTemplate?.enabledTypes?.scheduleAppointment !== false;

      if (isConfirmationEnabled && (client?.phone_e164 || client?.phoneNumber)) {
        const msg = await whatsappTemplates.getRenderedTemplate(
          organizationId,
          'scheduleAppointment',
          {
            ...appointmentDetails,
            cancellationLink,
          }
        );

        await whatsappService.sendMessage(
          organizationId,
          client?.phone_e164 || client?.phoneNumber,
          msg
        );
        console.log(`✅ Confirmación enviada para cita ${newAppointment._id}`);
      } else if (!isConfirmationEnabled) {
        console.log(`⏭️  Confirmación deshabilitada para cita ${newAppointment._id}`);
      }
      } // cierre del else (planLimits check)
    } catch (error) {
      console.error(
        `Error enviando la confirmación para ${client?.phoneNumber}:`,
        error.message
      );
    }

    // Guardar la cita en la base de datos
    const savedAppointment = await newAppointment.save();
    
    console.log('💾 Appointment guardado:', {
      id: savedAppointment._id,
      hasTokenHash: !!savedAppointment.cancelTokenHash,
      tokenHashPreview: savedAppointment.cancelTokenHash ? savedAppointment.cancelTokenHash.substring(0, 20) + '...' : 'N/A',
    });

    // 🔔 Notificar al empleado asignado
    if (employee) {
      try {
        const clientName = client?.name || 'Un cliente';
        const formattedDate = moment.tz(parsedStartDate, timezone).format('DD/MM/YYYY [a las] hh:mm A');
        
        await notificationService.createNotification({
          title: '📅 Nueva cita asignada',
          message: `${clientName} tiene una cita de ${serviceDetails.name} programada para el ${formattedDate}`,
          organizationId: organizationId,
          employeeId: employee,
          type: 'reservation',
          status: 'unread',
          frontendRoute: '/manage-agenda'
        });
        console.log('🔔 Notificación enviada al empleado:', employee);
      } catch (notificationError) {
        console.error('❌ Error al notificar empleado:', notificationError);
        // No fallar la creación si falla la notificación
      }
    }
    
    return savedAppointment;
  },

  // Crear múltiples citas (batch)
  createAppointmentsBatch: async (payload) => {
    console.log('🎯 [createAppointmentsBatch] Iniciando con payload:', {
      services: payload.services,
      client: payload.client,
      startDate: payload.startDate,
      skipNotification: payload.skipNotification,
      customDurations: payload.customDurations,
    });

    const {
      services,
      employee, // Puede ser string (un empleado para todas) o array (uno por servicio)
      employees, // Array de empleados (nuevo parámetro, tiene prioridad sobre employee)
      employeeRequestedByClient,
      client,
      startDate,
      endDate, // 🕐 Fecha de fin personalizada (opcional, solo para un servicio)
      organizationId,
      advancePayment,
      customPrices = {},
      additionalItemsByService = {},
      skipNotification = false, // 🔇 Nueva opción para no enviar WhatsApp
      sharedGroupId = null, // 🔗 GroupId compartido (opcional)
      sharedTokenHash = null, // 🔗 Token hash compartido (opcional)
      customDurations = {}, // 🕐 Duraciones personalizadas por servicio (en minutos)
      clientPackageId = null, // 📦 Paquete de sesiones del cliente
      usePackageForServices = {}, // 📦 Mapeo serviceId -> clientPackageId
    } = payload;
    
    if (!Array.isArray(services) || services.length === 0) {
      throw new Error("Debe enviar al menos un servicio.");
    }
    
    // Normalizar empleados: puede venir como 'employees' (array) o 'employee' (string)
    let employeeList;
    if (employees && Array.isArray(employees)) {
      // Si viene employees, validar que tenga el mismo length que services
      if (employees.length !== services.length) {
        throw new Error("El array de empleados debe tener la misma longitud que el de servicios.");
      }
      employeeList = employees;
    } else if (employee) {
      // Si viene employee (string), replicarlo para todos los servicios
      employeeList = Array(services.length).fill(employee);
    } else {
      throw new Error("Debe proporcionar al menos un empleado (employee o employees).");
    }
    
    if (!client || !startDate || !organizationId) {
      throw new Error("Faltan datos requeridos para crear las citas.");
    }

    const org = await organizationService.getOrganizationById(organizationId);
    if (!org) throw new Error("Organización no encontrada.");

    // 🔧 Definir timezone ANTES del try para que esté disponible en efectos externos
    const timezone = org.timezone || 'America/Bogota';

    const session = await mongoose.startSession();
    let committed = false;

    const created = [];
    const groupId = sharedGroupId || new mongoose.Types.ObjectId();
    
    // 🔗 Usar token compartido si se provee, sino generar uno nuevo
    let groupCancelToken, groupCancelTokenHash;
    if (sharedTokenHash) {
      groupCancelTokenHash = sharedTokenHash;
      console.log('🔗 Usando token compartido para grupo:', groupId);
    } else {
      const generated = cancellationService.generateCancelToken();
      groupCancelToken = generated.token;
      groupCancelTokenHash = generated.hash;
      console.log('🔑 Token nuevo generado para grupo:', groupId);
    }

    // Enlace único para confirmar/cancelar el grupo (solo si tenemos el token en texto plano)
    const groupCancellationLink = groupCancelToken
      ? generateCancellationLink(groupCancelToken, org)
      : null;

    try {
      session.startTransaction();

      // 🔧 FIX: Parsear correctamente según el tipo de startDate
      let currentStart;
      if (typeof startDate === 'string') {
        // Si viene como string sin timezone, parsearlo en la timezone de la org
        const parsed = moment.tz(startDate, 'YYYY-MM-DDTHH:mm:ss', timezone);
        currentStart = parsed.toDate();
      } else if (startDate instanceof Date) {
        // Si viene como Date, ya está en UTC - usarlo directamente
        // (las fechas de MongoDB siempre están en UTC)
        currentStart = startDate;
      } else {
        throw new Error('startDate debe ser un Date o string');
      }
      // ⏱️ Truncar a minuto exacto para evitar desfases de segundos
      currentStart = new Date(Math.floor(currentStart.getTime() / 60000) * 60000);

      for (let i = 0; i < services.length; i++) {
        const serviceId = services[i];
        const employeeForThisService = employeeList[i]; // 👤 Empleado específico para este servicio
        
        const svc = await serviceService.getServiceById(serviceId);
        if (!svc) throw new Error(`Servicio no encontrado: ${serviceId}`);

        // 🕐 Calcular endDate para este servicio
        // Prioridad:
        // 1. Si hay customDurations[serviceId], usar esa duración
        // 2. Si hay UN solo servicio y endDate personalizado, usar ese
        // 3. Si no, usar la duración estándar del servicio
        let serviceEnd;
        const customDuration = customDurations[serviceId];

        if (customDuration !== undefined && customDuration !== null) {
          // Usar duración personalizada del frontend
          serviceEnd = new Date(currentStart.getTime() + customDuration * 60000);
          console.log(`🕐 Servicio ${i + 1} (${svc.name}): usando duración personalizada ${customDuration} min`);
        } else if (services.length === 1 && endDate) {
          // Un solo servicio con endDate personalizado → respetar duración personalizada
          if (typeof endDate === 'string') {
            const parsed = moment.tz(endDate, 'YYYY-MM-DDTHH:mm:ss', timezone);
            serviceEnd = parsed.toDate();
          } else if (endDate instanceof Date) {
            serviceEnd = endDate;
          } else {
            const duration = svc.duration ?? 0;
            serviceEnd = new Date(currentStart.getTime() + duration * 60000);
          }
          console.log(`🕐 Servicio único con endDate personalizado`);
        } else {
          // Usar duración estándar del servicio
          const duration = svc.duration ?? 0;
          serviceEnd = new Date(currentStart.getTime() + duration * 60000);
          console.log(`🕐 Servicio ${i + 1} (${svc.name}): usando duración estándar ${duration} min`);
        }
        // ⏱️ Truncar serviceEnd a minuto exacto para consistencia
        serviceEnd = new Date(Math.floor(serviceEnd.getTime() / 60000) * 60000);

        // 🔍 VALIDACIÓN DE DISPONIBILIDAD - Verificar citas simultáneas del mismo servicio
        // Contar cuántas citas del MISMO servicio tiene el empleado en ese horario.
        // maxConcurrentAppointments es un límite por servicio, no por empleado en total.
        // Condición estándar de solapamiento: existente.inicio < nueva.fin Y existente.fin > nueva.inicio
        const simultaneousCount = await appointmentModel.countDocuments({
          employee: employeeForThisService,
          service: serviceId,
          organizationId,
          status: { $nin: ['cancelled_by_admin', 'cancelled_by_customer', 'cancelled', 'rejected', 'attended', 'no_show'] },
          startDate: { $lt: serviceEnd },
          endDate: { $gt: currentStart },
        });

        // 👥 Verificar límite de citas simultáneas configurado en el servicio
        const maxConcurrent = svc.maxConcurrentAppointments ?? 1;
        if (simultaneousCount >= maxConcurrent) {
          console.log(`⚠️ Límite de citas simultáneas alcanzado para empleado ${employeeForThisService} en ${currentStart}. Simultáneas: ${simultaneousCount}, Máximo: ${maxConcurrent}`);
          throw new Error(`No hay disponibilidad para el servicio ${svc.name} en el horario solicitado (límite de ${maxConcurrent} cita${maxConcurrent > 1 ? 's' : ''} simultánea${maxConcurrent > 1 ? 's' : ''})`);
        }

        const additionalItems = additionalItemsByService[serviceId] || [];
        for (const item of additionalItems) {
          if (
            !item?.name ||
            item.price == null ||
            item.price < 0 ||
            item.quantity < 0
          ) {
            throw new Error("Adicionales inválidos en la cita");
          }
        }

        const basePrice = customPrices[serviceId] ?? svc.price ?? 0;
        const additionalCost = additionalItems.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0
        );
        const totalPrice = basePrice + additionalCost;

        // 📦 Determinar si usar paquete de sesiones para este servicio
        const pkgIdForService = usePackageForServices[serviceId] || clientPackageId;
        const usingPackage = !!pkgIdForService;
        const finalTotalPrice = usingPackage ? 0 : totalPrice;

        // 🔗 Usar el mismo token hash para TODAS las citas del grupo
        const doc = new appointmentModel({
          groupId,
          service: serviceId,
          employee: employeeForThisService, // 👤 Empleado específico
          employeeRequestedByClient: !!employeeRequestedByClient,
          client,
          startDate: currentStart,
          endDate: serviceEnd,
          organizationId,
          advancePayment: usingPackage ? 0 : advancePayment,
          customPrice: usingPackage ? 0 : customPrices[serviceId],
          additionalItems: usingPackage ? [] : additionalItems,
          totalPrice: finalTotalPrice,
          status: "pending",
          cancelTokenHash: groupCancelTokenHash, // 🔗 Mismo hash para todo el grupo
          cancellationLink: groupCancellationLink || undefined,
          clientPackageId: pkgIdForService || undefined,
        });

        const saved = await doc.save({ session });

        // 📦 Consumir sesión del paquete si aplica
        if (pkgIdForService) {
          await packageService.consumeSession(
            pkgIdForService,
            serviceId,
            saved._id,
            { session }
          );
        }
        created.push({
          saved,
          svc,
          start: new Date(currentStart),
          end: new Date(serviceEnd),
        });
        currentStart = serviceEnd; // la siguiente inicia donde terminó esta
      }

      await session.commitTransaction();
      committed = true;
    } catch (err) {
      if (!committed) {
        try {
          await session.abortTransaction();
        } catch {}
      }
      throw err;
    } finally {
      await session.endSession();
    }

    // ---------- EFECTOS EXTERNOS (fuera de la transacción) ----------
    try {
      // 🔔 Notificar a los empleados asignados
      if (created.length > 0) {
        const uniqueEmployees = [...new Set(created.map(c => c.saved.employee?.toString()).filter(Boolean))];
        
        for (const employeeId of uniqueEmployees) {
          try {
            const employeeName = await employeeService.getEmployeeById(employeeId);
            const employeeAppointments = created.filter(c => c.saved.employee?.toString() === employeeId);
            const clientName = client?.name || 'Un cliente';
            
            let notificationMessage = '';
            if (employeeAppointments.length === 1) {
              const apt = employeeAppointments[0];
              const formattedDate = moment.tz(apt.start, timezone).format('DD/MM/YYYY [a las] hh:mm A');
              notificationMessage = `${clientName} tiene una cita de ${apt.svc.name} programada para el ${formattedDate}`;
            } else {
              notificationMessage = `${clientName} tiene ${employeeAppointments.length} citas programadas:\n`;
              employeeAppointments.forEach((apt, index) => {
                const formattedDate = moment.tz(apt.start, timezone).format('DD/MM/YYYY [a las] hh:mm A');
                notificationMessage += `${index + 1}. ${apt.svc.name} - ${formattedDate}\n`;
              });
            }

            await notificationService.createNotification({
              title: employeeAppointments.length === 1 ? '📅 Nueva cita asignada' : `📅 ${employeeAppointments.length} nuevas citas`,
              message: notificationMessage,
              organizationId: organizationId,
              employeeId: employeeId,
              type: 'reservation',
              status: 'unread',
              frontendRoute: '/manage-agenda'
            });
            console.log(`🔔 Notificación enviada al empleado: ${employeeName?.names || employeeId}`);
          } catch (notificationError) {
            console.error('❌ Error al notificar empleado:', notificationError);
          }
        }
      }

      if (created.length > 0 && !skipNotification) { // 🔇 Solo enviar si no se pidió omitir
        
        // 🔍 Si hay groupId, buscar TODAS las citas del grupo para el mensaje
        let allGroupAppointments = created;
        if (groupId) {
          console.log('🔍 Buscando todas las citas del grupo:', groupId);
          const groupAppts = await appointmentModel
            .find({ groupId })
            .populate('service')
            .sort({ startDate: 1 });
          
          if (groupAppts && groupAppts.length > 0) {
            console.log(`✅ Encontradas ${groupAppts.length} citas del grupo`);
            allGroupAppointments = groupAppts.map(appt => ({
              start: appt.startDate,
              end: appt.endDate,
              svc: appt.service,
              saved: appt,
            }));
          }
        }
        
        const first = allGroupAppointments[0];
        const last = allGroupAppointments[allGroupAppointments.length - 1];

        const orgTimeFormat = org.timeFormat || '12h';
        const dateRange =
          allGroupAppointments.length === 1
            ? fmt(first.start, timezone, orgTimeFormat)
            : `${fmt(first.start, timezone, orgTimeFormat)} – ${fmtTime(last.end, timezone, orgTimeFormat)}`;

        const servicesForMsg = allGroupAppointments.map((c) => ({
          name: c.svc.name,
          start: fmtTime(c.start, timezone, orgTimeFormat),
          end: fmtTime(c.end, timezone, orgTimeFormat),
        }));

        // 🔗 Enlace de confirmación/cancelación ya generado (solo disponible si hubo token en texto plano)
        if (!groupCancellationLink) {
          console.warn('⚠️ Usando token compartido de reservas. No se puede generar link sin token en texto plano.');
          console.warn('⚠️ El mensaje debe enviarse desde donde se tiene el token original.');
          return created.map(c => c.saved);
        }

        // Cargar cliente/empleado si vinieron como IDs
        const clientDoc =
          typeof client === "string"
            ? await clientService.getClientById(client)
            : client;
        const employeeDoc =
          typeof employee === "string"
            ? await employeeService.getEmployeeById(employee)
            : employee;


        // Usar phone_e164 (ya tiene el código de país correcto) con fallback al phoneNumber
        const phoneE164 = clientDoc?.phone_e164 || clientDoc?.phoneNumber;
        if (!phoneE164) {
          console.warn(
            "Cliente sin teléfono utilizable; no se enviará WhatsApp."
          );
          return created.map((c) => c.saved);
        }

        // Armar datos para el template
        const templateData = {
          names: clientDoc?.name || "Estimado cliente",
          dateRange,
          organization: org.name,
          address: org.address || "",
          servicesList: servicesForMsg.map((s, i) => `  ${i + 1}. ${s.name} (${s.start} – ${s.end})`).join('\n'),
          employee: employeeDoc?.names || "Nuestro equipo",
          cancellationLink: groupCancellationLink, // 🔗 Un solo enlace para todo el grupo
        };

        // Verificar si el plan permite confirmaciones automáticas
        const batchPlanLimits = await membershipService.getPlanLimits(organizationId);
        const planAllowsConfirmations = !(batchPlanLimits && batchPlanLimits.autoConfirmations === false);

        // 🆕 Verificar si el envío de confirmación batch está habilitado
        const whatsappTemplate = await WhatsappTemplate.findOne({ organizationId });
        const isBatchConfirmationEnabled = whatsappTemplate?.enabledTypes?.scheduleAppointmentBatch !== false;

        if (planAllowsConfirmations && isBatchConfirmationEnabled) {
          // Usar template personalizado de la organización
          const msg = await whatsappTemplates.getRenderedTemplate(
            organizationId,
            'scheduleAppointmentBatch',
            templateData
          );

          // Envío 1-a-1 (mensaje ya renderizado)
          await waIntegrationService.sendMessage({
            orgId: organizationId,
            phone: phoneE164,
            message: msg,
            image: null,
          });
          console.log(`✅ Confirmación batch enviada (${allGroupAppointments.length} citas)`);
        } else {
          console.log(`⏭️  Confirmación batch deshabilitada`);
        }
      }
    } catch (error) {
      console.error(
        `Error enviando la confirmación batch a ${client?.phoneNumber}:`,
        error?.message || error
      );
    }

    return created.map((c) => c.saved);
  },

  // Obtener todas las citas
  getAppointments: async () => {
    return await appointmentModel
      .find()
      .populate("service")
      .populate("employee")
      .populate("client")
      .exec();
  },

  // Obtener citas por organizationId con rango de fechas opcional
  getAppointmentsByOrganizationWithDates: async (
    organizationId,
    startDate,
    endDate,
    employeeIds = null
  ) => {
    try {
      const query = { organizationId };

      // Si NO se especifican fechas, calcular el rango por defecto (mes anterior, actual y siguiente)
      if (!startDate || !endDate) {
        const now = new Date();

        // Primer día del mes anterior
        const firstDayPrevMonth = new Date(
          now.getFullYear(),
          now.getMonth() - 1,
          1
        );

        // Último día del mes siguiente
        const lastDayNextMonth = new Date(
          now.getFullYear(),
          now.getMonth() + 2,
          0,
          23,
          59,
          59,
          999
        );

        startDate = firstDayPrevMonth;
        endDate = lastDayNextMonth;
      }

      // Las fechas vienen del frontend ya en UTC representando el inicio/fin del día
      // en el timezone local del navegador. Las usamos directamente.
      const start = new Date(startDate);
      const end = new Date(endDate);

      // Añadir rango de fechas al query (en UTC)
      // Buscar citas cuya fecha de inicio esté dentro del rango
      query.startDate = { 
        $gte: start,
        $lte: end
      };

      // ✅ Filtrar por empleados específicos si se proporcionan
      if (employeeIds && Array.isArray(employeeIds) && employeeIds.length > 0) {
        query.employee = { $in: employeeIds };
      }

      // 🔍 NO filtrar por status - incluir TODAS las citas (incluso canceladas)
      // Esto permite que DayModal muestre las citas canceladas en su sección

      return await appointmentModel
        .find(query)
        .populate("service")
        .populate("employee")
        .populate("client")
        .exec();
    } catch (error) {
      throw new Error(
        "Error al obtener citas de la organización: " + error.message
      );
    }
  },

    // Agregación timezone-aware para generar buckets (día/semana/mes)
    getAppointmentsAggregatedByRange: async (
      organizationId,
      startDate,
      endDate,
      granularity = "day",
      employeeIds = null
    ) => {
      try {
        const org = await organizationService.getOrganizationById(organizationId);
        const timezone = (org && org.timezone) || 'America/Bogota';

        // Convertir límites a UTC según timezone
        const start = moment.tz(startDate, timezone).startOf('day').utc().toDate();
        const end = moment.tz(endDate, timezone).endOf('day').utc().toDate();

        const match = {
          organizationId: new mongoose.Types.ObjectId(organizationId),
          startDate: { $gte: start },
          endDate: { $lte: end },
        };

        if (employeeIds && Array.isArray(employeeIds) && employeeIds.length > 0) {
          match.employee = { $in: employeeIds.map((id) => new mongoose.Types.ObjectId(id)) };
        }

        // Formato para $dateToString según granularidad
        let format = "%Y-%m-%d"; // day
        if (granularity === "week") format = "%Y-%U"; // year-weeknumber
        if (granularity === "month") format = "%Y-%m"; // year-month

        const pipeline = [
          { $match: match },
          {
            $group: {
              _id: {
                $dateToString: { format, date: "$startDate", timezone },
              },
              ingresos: { $sum: { $ifNull: ["$totalPrice", 0] } },
              citas: { $sum: 1 },
              firstDate: { $min: "$startDate" },
            },
          },
          {
            $project: {
              _id: 0,
              key: "$_id",
              ingresos: 1,
              citas: 1,
              firstDate: 1,
            },
          },
          { $sort: { firstDate: 1 } },
        ];

        const result = await appointmentModel.aggregate(pipeline).exec();

        // Normalizar timestamp a milisegundos y devolver
        return result.map((r) => ({
          key: r.key,
          ingresos: r.ingresos || 0,
          citas: r.citas || 0,
          timestamp: r.firstDate ? new Date(r.firstDate).getTime() : null,
        }));
      } catch (error) {
        throw new Error("Error al agregar citas: " + error.message);
      }
    },

  // Obtener una cita por ID
  getAppointmentById: async (id) => {
    const appointment = await appointmentModel.findById(id);
    if (!appointment) {
      throw new Error("Cita no encontrada");
    }
    return appointment;
  },

  // Obtener las citas de un empleado
  getAppointmentsByEmployee: async (employeeId) => {
    return await appointmentModel
      .find({ employee: employeeId })
      .populate("service")
      .populate("client")
      .exec();
  },

  // Obtener las citas de un cliente con filtro opcional por estado
  getAppointmentsByClient: async (client, status = null) => {
    const query = { client };

    // Si se especifica un filtro de estado, aplicarlo
    if (status) {
      // Puede ser un estado individual o múltiples separados por coma
      const statuses = status.split(',').map(s => s.trim());
      if (statuses.length === 1) {
        query.status = statuses[0];
      } else {
        query.status = { $in: statuses };
      }
    }

    return await appointmentModel
      .find(query)
      .populate("service")
      .populate("employee")
      .sort({ startDate: -1 }) // Ordenar por fecha descendente
      .exec();
  },

  // Reemplaza tu updateAppointment por este
  updateAppointment: async (id, updatedData) => {
    const appt = await appointmentModel.findById(id);
    if (!appt) throw new Error("Cita no encontrada");

    // Obtener organización para timezone
    const orgId = updatedData.organizationId || appt.organizationId;
    const org = await organizationService.getOrganizationById(orgId);
    if (!org) throw new Error("Organización no encontrada");
    const timezone = org.timezone || 'America/Bogota';

    // 1) Resolver el "nuevo servicio" a partir de:
    //    - updatedData.service (preferido), o
    //    - updatedData.services[0] (compatibilidad si el FE envía array)
    let newServiceId =
      updatedData.service ??
      (Array.isArray(updatedData.services)
        ? updatedData.services[0]
        : undefined);

    // 2) Determinar startDate base para cálculos (si no llega, usamos el actual)
    const newStart = updatedData.startDate
      ? moment.tz(updatedData.startDate, 'YYYY-MM-DDTHH:mm:ss', timezone).toDate()
      : new Date(appt.startDate);

    // 3) Resolver additionalItems (dos formatos soportados)
    //    - updatedData.additionalItems (array plano)
    //    - updatedData.additionalItemsByService[serviceId] (mapa por servicio)
    let additionalItems = updatedData.additionalItems;
    if (
      !additionalItems &&
      updatedData.additionalItemsByService &&
      newServiceId
    ) {
      additionalItems = updatedData.additionalItemsByService[newServiceId];
    }
    if (!Array.isArray(additionalItems)) {
      additionalItems = appt.additionalItems || [];
    }

    // Validar additionalItems
    for (const item of additionalItems) {
      if (
        !item?.name ||
        item.price == null ||
        item.price < 0 ||
        item.quantity < 0
      ) {
        throw new Error("Adicionales inválidos en la cita");
      }
    }

    // 4) Cargar servicio (si cambió) o el actual si necesitamos precio/duración
    let svc = null;
    let serviceChanged = false;

    if (newServiceId && String(newServiceId) !== String(appt.service)) {
      svc = await serviceService.getServiceById(newServiceId);
      if (!svc) throw new Error("Servicio nuevo no encontrado");
      serviceChanged = true;
    } else {
      // Si no cambió el servicio pero necesitamos precio/duración, lo cargamos igual
      // (por si el documento no tiene el service poblado)
      svc = await serviceService.getServiceById(appt.service);
      if (!svc) throw new Error("Servicio actual no encontrado");
    }

    // 5) customPrice (prioriza el explícito del payload)
    //    Si no hay customPrice, tomamos el precio del servicio
    const explicitCustomPrice =
      updatedData.customPrice != null
        ? Number(updatedData.customPrice)
        : appt.customPrice != null
        ? Number(appt.customPrice)
        : undefined;

    const basePrice =
      explicitCustomPrice != null
        ? explicitCustomPrice
        : Number(svc.price ?? 0);

    // 6) Recalcular totalPrice
    const additionalCost = additionalItems.reduce(
      (sum, it) => sum + Number(it.price) * Number(it.quantity),
      0
    );
    const totalPrice = basePrice + additionalCost;

    // 7) Recalcular endDate:
    //    - Si viene endDate explícito en el payload → usarlo (duración personalizada)
    //    - Si cambió el servicio → usar la duración del nuevo servicio
    //    - Si no cambió pero llegó startDate → mantener la misma duración anterior
    //      (duración = appt.endDate - appt.startDate)
    let newEnd;
    if (updatedData.endDate) {
      // 🕐 Respetar endDate personalizado si viene en el payload
      newEnd = moment.tz(updatedData.endDate, 'YYYY-MM-DDTHH:mm:ss', timezone).toDate();
    } else if (serviceChanged) {
      const durationMin = Number(svc.duration ?? 0);
      newEnd = new Date(newStart.getTime() + durationMin * 60000);
    } else if (updatedData.startDate) {
      const prevDurationMs =
        new Date(appt.endDate).getTime() - new Date(appt.startDate).getTime();
      newEnd = new Date(newStart.getTime() + Math.max(prevDurationMs, 0));
    } else {
      // No cambió servicio ni startDate ni endDate → mantener el actual
      newEnd = new Date(appt.endDate);
    }

    // 8) Set de campos básicos
    if (serviceChanged) appt.service = newServiceId;
    if (updatedData.employee) appt.employee = updatedData.employee;
    if (updatedData.employeeRequestedByClient != null) {
      appt.employeeRequestedByClient = !!updatedData.employeeRequestedByClient;
    }
    if (updatedData.client) appt.client = updatedData.client;
    if (updatedData.organizationId)
      appt.organizationId = updatedData.organizationId;
    if (updatedData.advancePayment != null)
      appt.advancePayment = updatedData.advancePayment;

    // Fechas
    appt.startDate = newStart;
    appt.endDate = newEnd;

    // Precios / adicionales
    appt.customPrice =
      explicitCustomPrice != null ? explicitCustomPrice : undefined;
    appt.additionalItems = additionalItems;
    appt.totalPrice = totalPrice;

    // Si envían status u otros campos sueltos (nota, etc.), respétalos
    const passthrough = ["status", "notes", "source", "meta", "reminderSent"];
    for (const k of passthrough) {
      if (updatedData[k] != null) appt[k] = updatedData[k];
    }

    return await appt.save();
  },

  // Eliminar una cita
  deleteAppointment: async (id) => {
    const appointment = await appointmentModel.findById(id);
    if (!appointment) {
      throw new Error("Cita no encontrada");
    }

    await appointment.deleteOne();
    return { message: "Cita eliminada correctamente" };
  },

  sendDailyReminders: async () => {
    try {
      // Obtener todas las organizaciones con recordatorios habilitados
      const organizations = await organizationService.getOrganizations();
      const orgsWithRemindersBase = organizations.filter(
        (org) => org.reminderSettings?.enabled !== false
      );

      // Filtrar por plan: excluir organizaciones cuyo plan no permite autoReminders
      const orgsWithReminders = [];
      for (const org of orgsWithRemindersBase) {
        const planLimits = await membershipService.getPlanLimits(org._id);
        if (planLimits && planLimits.autoReminders === false) {
          console.log(`[Reminders] Org ${org.name}: recordatorios bloqueados por plan`);
          continue;
        }
        orgsWithReminders.push(org);
      }

      if (!orgsWithReminders.length) {
        console.log("[Reminders] No hay organizaciones con recordatorios habilitados.");
        return;
      }

      let totalOk = 0;
      let totalSkipped = 0;

      /**
       * Procesa una pasada de recordatorio para una organización.
       * Se reutiliza para el primer y segundo recordatorio.
       * @param {Object} org - Organización
       * @param {number} hoursBefore - Horas antes de la cita
       * @param {string} sentField - Campo booleano de tracking (reminderSent | secondReminderSent)
       * @param {string} bulkIdField - Campo de bulkId (reminderBulkId | secondReminderBulkId)
       * @param {string} label - Etiqueta para logs
       * @param {string} templateType - Tipo de plantilla a usar ('reminder' | 'secondReminder')
       * @returns {{ ok: number, skipped: number }}
       */
      const processReminderPass = async (org, hoursBefore, sentField, bulkIdField, label, templateType = 'reminder') => {
        const orgId = org._id.toString();
        const timezone = org.timezone || 'America/Bogota';
        const nowInOrgTz = moment.tz(timezone);
        const currentHourOrg = nowInOrgTz.hour();

        // Calcular ventana de tiempo objetivo (normal: ahora + hoursBefore)
        const targetTimeStart = moment.tz(timezone).add(hoursBefore, 'hours').startOf('hour').toDate();
        const targetTimeEnd = moment.tz(timezone).add(hoursBefore, 'hours').endOf('hour').toDate();

        // Buscar citas en la ventana normal
        const appointmentsInWindow = await appointmentModel
          .find({
            organizationId: orgId,
            startDate: { $gte: targetTimeStart, $lt: targetTimeEnd },
            [sentField]: { $ne: true },
            status: { $nin: ['cancelled', 'cancelled_by_customer', 'cancelled_by_admin'] },
          })
          .populate("client")
          .populate("service")
          .populate("employee")
          .populate("organizationId");

        // Catch-up: buscar citas cuyo recordatorio ideal cayó fuera de la ventana horaria
        // Estas son citas entre ahora y ahora+hoursBefore que aún no tienen recordatorio
        const catchupStart = moment.tz(timezone).toDate();
        const catchupAppointments = await appointmentModel
          .find({
            organizationId: orgId,
            startDate: { $gt: catchupStart, $lt: targetTimeStart },
            [sentField]: { $ne: true },
            status: { $nin: ['cancelled', 'cancelled_by_customer', 'cancelled_by_admin'] },
          })
          .populate("client")
          .populate("service")
          .populate("employee")
          .populate("organizationId");

        if (catchupAppointments.length > 0) {
          console.log(`[${org.name}] [${label}] Catch-up: ${catchupAppointments.length} citas pendientes de recordatorio`);
        }

        // Combinar ambas búsquedas sin duplicados
        const seenIds = new Set();
        const allAppointmentsInWindow = [];
        for (const appt of [...appointmentsInWindow, ...catchupAppointments]) {
          const id = appt._id.toString();
          if (!seenIds.has(id)) {
            seenIds.add(id);
            allAppointmentsInWindow.push(appt);
          }
        }

        if (!allAppointmentsInWindow.length) {
          return { ok: 0, skipped: 0 };
        }

        // Obtener todos los clientes únicos
        const clientIds = [...new Set(
          allAppointmentsInWindow
            .map(appt => appt.client?._id?.toString())
            .filter(Boolean)
        )];

        // Rango para consolidar citas del mismo cliente
        // Cubrir desde hoy hasta el día del target (puede ser el mismo día o el siguiente)
        const todayStr = moment.tz(timezone).format('YYYY-MM-DD');
        const targetDateStr = moment.tz(targetTimeStart, timezone).format('YYYY-MM-DD');
        const dayStart = moment.tz(todayStr, timezone).startOf('day').toDate();
        const dayEnd = moment.tz(targetDateStr, timezone).endOf('day').toDate();

        // Buscar TODAS las citas en el rango para estos clientes
        const appointments = await appointmentModel
          .find({
            organizationId: orgId,
            client: { $in: clientIds },
            startDate: { $gte: dayStart, $lt: dayEnd },
            [sentField]: { $ne: true },
            status: { $nin: ['cancelled', 'cancelled_by_customer', 'cancelled_by_admin'] },
          })
          .populate("client")
          .populate("service")
          .populate("employee")
          .populate("organizationId");

        if (!appointments.length) {
          return { ok: 0, skipped: 0 };
        }

        console.log(`[${org.name}] [${label}] Procesando ${appointments.length} citas (${hoursBefore}h antes)`);

        // Verificar sesión de WhatsApp
        const orgClientId = org.clientIdWhatsapp;
        if (!orgClientId) {
          console.warn(
            `[${org.name}] [${label}] Sin clientIdWhatsapp. Se omiten ${appointments.length} recordatorios.`
          );
          return { ok: 0, skipped: appointments.length };
        }

        // Agrupar por teléfono (cliente)
        const byPhone = new Map();
        const fmtHour = new Intl.DateTimeFormat("es-ES", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: (org.timeFormat || '12h') !== '24h',
          timeZone: timezone,
        });
        const fmtDay = new Intl.DateTimeFormat("es-ES", {
          day: "numeric",
          month: "long",
          timeZone: timezone,
        });

        for (const appt of appointments) {
          // Usar phone_e164 (ya tiene código de país correcto) con fallback
          const clientPhone = appt?.client?.phone_e164 || appt?.client?.phoneNumber;
          if (!clientPhone) continue;

          // Formato WhatsApp: sin "+" y con "1" extra para México
          const { toWhatsappFormat } = await import("../utils/phoneUtils.js");
          const phone = toWhatsappFormat(clientPhone);

          const start = new Date(appt.startDate);
          const end = appt.endDate ? new Date(appt.endDate) : null;

          const serviceName = appt?.service
            ? `${appt.service.type || ""} - ${appt.service.name || ""}`.trim()
            : "Servicio";

          const timeLabel = end
            ? `${fmtHour.format(start)} – ${fmtHour.format(end)}`
            : `${fmtHour.format(start)}`;

          if (!byPhone.has(phone)) {
            byPhone.set(phone, {
              phone,
              names: appt?.client?.name || "Cliente",
              services: [],
              firstStart: start,
              lastEnd: end || start,
              employees: new Set(),
              apptIds: new Set(),
              cancellationLink: null,
              recommendations: new Set(),
            });
          }

          const bucket = byPhone.get(phone);
          bucket.services.push({ name: serviceName, time: timeLabel });
          // Agregar recomendaciones del servicio si existen
          if (appt?.service?.recommendations) {
            bucket.recommendations.add(appt.service.recommendations);
          }
          if (start < bucket.firstStart) bucket.firstStart = start;
          if ((end || start) > bucket.lastEnd) bucket.lastEnd = end || start;
          if (appt?.employee?.names) bucket.employees.add(appt.employee.names);
          bucket.apptIds.add(String(appt._id));
          if (!bucket.cancellationLink && appt?.cancellationLink) {
            bucket.cancellationLink = appt.cancellationLink;
          }
        }

        // Construir items para la campaña
        const items = [];
        const includedIds = [];

        for (const bucket of byPhone.values()) {
          if (!bucket.services.length) continue;

          const servicesList = bucket.services
            .map((s, i) => `  ${i + 1}. ${s.name} (${s.time})`)
            .join("\n");

          const dateRange =
            bucket.firstStart.getTime() === bucket.lastEnd.getTime()
              ? `${fmtDay.format(bucket.firstStart)} ${fmtHour.format(bucket.firstStart)}`
              : `${fmtDay.format(bucket.firstStart)} ${fmtHour.format(bucket.firstStart)} – ${fmtHour.format(bucket.lastEnd)}`;

          const countNum = bucket.services.length;
          const isSingle = countNum === 1;

          // Construir bloque de recomendaciones si existen
          const recommendationsArr = Array.from(bucket.recommendations).filter(Boolean);
          const recommendationsBlock = recommendationsArr.length > 0
            ? `\n\n📝 *Recomendaciones:*\n${recommendationsArr.map(r => `• ${r}`).join('\n')}`
            : "";

          const vars = {
            names: bucket.names,
            date_range: dateRange,
            organization: org.name || "",
            address: org.address || "",
            services_list: servicesList,
            employee: Array.from(bucket.employees).join(", "),
            count: String(countNum),
            cita_pal: isSingle ? "cita" : "citas",
            agendada_pal: isSingle ? "agendada" : "agendadas",
            manage_block: bucket.cancellationLink
              ? `${bucket.cancellationLink.replace('source=confirmation', 'source=reminder')}\n\n`
              : "",
            recommendations: recommendationsBlock,
          };

          items.push({ phone: bucket.phone, vars });
          includedIds.push(...Array.from(bucket.apptIds));
        }

        if (!items.length) {
          console.log(`[${org.name}] [${label}] No hay items válidos (teléfonos).`);
          return { ok: 0, skipped: 0 };
        }

        // Enviar campaña
        try {
          const targetDateFmt = targetTimeStart.toISOString().slice(0, 10);
          const title = `${label} ${targetDateFmt} ${currentHourOrg}:00 (${org.name})`;

          const { waBulkSend, waBulkOptIn } = await import("./waHttpService.js");

          const templateDoc = await WhatsappTemplate.findOne({ organizationId: org._id });
          const messageTpl = templateDoc?.[templateType] || whatsappTemplates.getDefaultTemplate(templateType);

          console.log(`[${org.name}] [${label}] 📤 Enviando campaña: ${items.length} mensajes`);

          try {
            await waBulkOptIn(items.map((it) => it.phone));
          } catch (e) {
            console.warn(`[${org.name}] [${label}] OptIn falló: ${e?.message || e}`);
          }

          const result = await waBulkSend({
            clientId: orgClientId,
            title,
            items,
            messageTpl: messageTpl,
            dryRun: false,
          });

          console.log(
            `[${org.name}] [${label}] Campaña enviada: ${result.prepared} mensajes (bulkId: ${result.bulkId})`
          );

          // Marcar citas con el campo correspondiente
          if (includedIds.length) {
            await appointmentModel.updateMany(
              { _id: { $in: includedIds } },
              { $set: { [sentField]: true, [bulkIdField]: result.bulkId } }
            );
          }

          return { ok: includedIds.length, skipped: 0 };
        } catch (err) {
          console.error(`[${org.name}] [${label}] Error enviando campaña:`, err.message);
          return { ok: 0, skipped: appointments.length };
        }
      };

      // Procesar cada organización
      for (const org of orgsWithReminders) {
        const sendTimeStart = org.reminderSettings?.sendTimeStart || "07:00";
        const sendTimeEnd = org.reminderSettings?.sendTimeEnd || "20:00";
        const timezone = org.timezone || 'America/Bogota';
        const nowInOrgTz = moment.tz(timezone);
        const currentHourOrg = nowInOrgTz.hour();
        const currentMinuteOrg = nowInOrgTz.minute();

        // Parsear horas del rango permitido
        const [startHour, startMinute] = sendTimeStart.split(":").map(Number);
        const [endHour, endMinute] = sendTimeEnd.split(":").map(Number);

        // Verificar si estamos dentro del rango horario permitido
        const currentTimeMinutes = currentHourOrg * 60 + currentMinuteOrg;
        const startTimeMinutes = startHour * 60 + startMinute;
        const endTimeMinutes = endHour * 60 + endMinute;

        if (currentTimeMinutes < startTimeMinutes || currentTimeMinutes > endTimeMinutes) {
          continue;
        }

        // Pasada 1: Recordatorio principal
        const hoursBefore = org.reminderSettings?.hoursBefore || 24;
        const r1 = await processReminderPass(org, hoursBefore, 'reminderSent', 'reminderBulkId', 'Recordatorio 1', 'reminder');
        totalOk += r1.ok;
        totalSkipped += r1.skipped;

        // Pasada 2: Segundo recordatorio (si habilitado)
        if (org.reminderSettings?.secondReminder?.enabled) {
          const secondHoursBefore = org.reminderSettings.secondReminder.hoursBefore || 2;
          const r2 = await processReminderPass(org, secondHoursBefore, 'secondReminderSent', 'secondReminderBulkId', 'Recordatorio 2', 'secondReminder');
          totalOk += r2.ok;
          totalSkipped += r2.skipped;
        }

        // Pequeño respiro entre organizaciones
        await sleep(300);
      }

      console.log(
        `[Reminders] Global vía Campañas — OK=${totalOk} | Skipped=${totalSkipped} | Total=${
          totalOk + totalSkipped
        }`
      );
    } catch (e) {
      console.error("Error en sendDailyReminders:", e.message);
    }
  },

  // Confirmar múltiples citas en batch
  batchConfirmAppointments: async (appointmentIds, organizationId) => {
    if (!Array.isArray(appointmentIds) || appointmentIds.length === 0) {
      throw new Error("Se requiere un array de IDs de citas");
    }

    const results = {
      confirmed: [],
      failed: [],
      alreadyConfirmed: [],
    };

    for (const appointmentId of appointmentIds) {
      try {
        // Obtener la cita
        const appointment = await appointmentModel.findById(appointmentId);
        
        if (!appointment) {
          results.failed.push({
            appointmentId,
            reason: "Cita no encontrada",
          });
          continue;
        }

        // Verificar que pertenezca a la organización (seguridad)
        if (String(appointment.organizationId) !== String(organizationId)) {
          results.failed.push({
            appointmentId,
            reason: "La cita no pertenece a la organización",
          });
          continue;
        }

        // Verificar si ya está confirmada
        if (appointment.status === "confirmed") {
          results.alreadyConfirmed.push({
            appointmentId,
            clientId: appointment.client,
          });
          continue;
        }

        // Verificar que no esté cancelada
        if (
          appointment.status === "cancelled" ||
          appointment.status === "cancelled_by_customer" ||
          appointment.status === "cancelled_by_admin"
        ) {
          results.failed.push({
            appointmentId,
            reason: "No se puede confirmar una cita cancelada",
          });
          continue;
        }

        // Actualizar estado a confirmed
        appointment.status = "confirmed";
        await appointment.save();

        // Registrar servicio en el cliente
        if (appointment.client) {
          try {
            await clientService.registerService(appointment.client);
          } catch (clientError) {
            console.warn(
              `Error al registrar servicio para cliente ${appointment.client}:`,
              clientError.message
            );
            // No fallar la confirmación si falla el registro del servicio
          }
        }

        results.confirmed.push({
          appointmentId,
          clientId: appointment.client,
        });
      } catch (error) {
        results.failed.push({
          appointmentId,
          reason: error.message,
        });
      }
    }

    return results;
  },

  /**
   * Auto-confirmar citas del día actual para una organización
   * Cambia estado de pending a confirmed y registra servicio al cliente
   * @param {string} organizationId - ID de la organización
   * @returns {Object} Resultado con citas confirmadas
   */
  autoConfirmTodayAppointments: async (organizationId) => {
    try {
      // Obtener organización para timezone
      const organization = await organizationService.getOrganizationById(organizationId);
      if (!organization) {
        throw new Error('Organización no encontrada');
      }

      const timezone = organization.timezone || 'America/Bogota';
      
      // Obtener inicio y fin del día actual en timezone de la organización
      const startOfDay = moment.tz(timezone).startOf('day').toDate();
      const endOfDay = moment.tz(timezone).endOf('day').toDate();

      // Buscar todas las citas pending del día actual
      const pendingAppointments = await appointmentModel.find({
        organizationId,
        status: 'pending',
        startDate: {
          $gte: startOfDay,
          $lte: endOfDay
        }
      }).populate('client', 'name phoneNumber phone_e164 phone_country');

      const results = {
        total: pendingAppointments.length,
        confirmed: [],
        failed: []
      };

      // Confirmar cada cita
      for (const appointment of pendingAppointments) {
        try {
          // Actualizar estado a confirmed
          appointment.status = 'confirmed';
          await appointment.save();

          // Registrar servicio en el cliente
          if (appointment.client && appointment.client._id) {
            try {
              await clientService.registerService(appointment.client._id);
            } catch (clientError) {
              console.warn(
                `Error al registrar servicio para cliente ${appointment.client._id}:`,
                clientError.message
              );
              // No fallar la confirmación si falla el registro del servicio
            }
          }

          results.confirmed.push({
            appointmentId: appointment._id,
            clientName: appointment.client?.name,
            startDate: appointment.startDate
          });
        } catch (error) {
          results.failed.push({
            appointmentId: appointment._id,
            reason: error.message
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Error en autoConfirmTodayAppointments:', error);
      throw error;
    }
  },
  /**
   * Marca la asistencia de una cita (attended / no_show).
   * Solo aplica a citas no canceladas.
   */
  async markAttendance(appointmentId, status, organizationId, notifyClient = false) {
    const validStatuses = ['attended', 'no_show'];
    if (!validStatuses.includes(status)) {
      const error = new Error('Estado de asistencia inválido. Use "attended" o "no_show".');
      error.statusCode = 400;
      throw error;
    }

    const appointment = await appointmentModel.findOne({
      _id: appointmentId,
      organizationId,
    }).populate('client').populate('service').populate('organizationId');

    if (!appointment) {
      const error = new Error('Cita no encontrada.');
      error.statusCode = 404;
      throw error;
    }

    if (appointment.status.includes('cancelled')) {
      const error = new Error('No se puede marcar asistencia en una cita cancelada.');
      error.statusCode = 400;
      throw error;
    }

    appointment.status = status;
    await appointment.save();

    // Enviar WhatsApp de no asistencia si se solicita
    if (status === 'no_show' && notifyClient && appointment.client && appointment.organizationId) {
      try {
        const org = appointment.organizationId;
        const client = appointment.client;
        const timezone = org.timezone || 'America/Bogota';
        const orgId = org._id || org;
        const noShowTimeFormat = org.timeFormat || '12h';

        const appointmentDate = moment.tz(appointment.startDate, timezone);
        const noShowTimeStr = noShowTimeFormat === '24h' ? 'HH:mm' : 'hh:mm A';

        const message = await whatsappTemplates.getRenderedTemplate(
          orgId.toString(),
          'clientNoShowAck',
          {
            names: client.name || 'Cliente',
            service: appointment.service?.name || 'Servicio',
            date: appointmentDate.format(`DD/MM/YYYY ${noShowTimeStr}`),
            organization: org.name,
          }
        );

        const phoneNumber = client.phone_e164 || client.phoneNumber;
        if (phoneNumber) {
          await whatsappService.sendMessage(orgId.toString(), phoneNumber, message);
          console.log(`✅ Mensaje de no asistencia enviado al cliente: ${client.name}`);
        }
      } catch (whatsappError) {
        console.error('[markAttendance] Error al enviar WhatsApp de no asistencia:', whatsappError);
        // No fallar la operación si falla el envío de WhatsApp
      }
    }

    return appointment;
  },

  // 💰 Registrar un pago para una cita
  addPaymentToAppointment: async (appointmentId, { amount, method, date, note, registeredBy }) => {
    const appt = await appointmentModel.findById(appointmentId);
    if (!appt) throw new Error('Cita no encontrada');
    appt.payments.push({ amount, method: method || 'cash', date: date || new Date(), note: note || '', registeredBy: registeredBy || undefined });
    // paymentStatus se recalcula en el pre-save middleware
    await appt.save();
    return appointmentModel.findById(appt._id)
      .populate('client')
      .populate('service')
      .populate('employee');
  },

  // 💰 Eliminar un pago de una cita
  removePaymentFromAppointment: async (appointmentId, paymentId) => {
    const appt = await appointmentModel.findById(appointmentId);
    if (!appt) throw new Error('Cita no encontrada');
    const before = appt.payments.length;
    appt.payments = appt.payments.filter(p => p._id.toString() !== paymentId);
    if (appt.payments.length === before) throw new Error('Pago no encontrado');
    await appt.save();
    return appointmentModel.findById(appt._id)
      .populate('client')
      .populate('service')
      .populate('employee');
  },
};

export default appointmentService;
