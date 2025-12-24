import appointmentModel from "../models/appointmentModel.js";
import organizationService from "./organizationService.js";
import serviceService from "./serviceService.js";
import whatsappService from "./sendWhatsappService.js";
import whatsappTemplates from "../utils/whatsappTemplates.js";
import clientService from "../services/clientService.js";
import employeeService from "../services/employeeService.js";
import { waIntegrationService } from "../services/waIntegrationService.js";
import { hasUsablePhone, normalizeToCOE164 } from "../utils/timeAndPhones.js";
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
const TZ = "America/Bogota";
const fmt = (d) =>
  new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  }).format(new Date(d));

const fmtTime = (d) =>
  new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
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

    // Comprobar citas superpuestas
    // const overlappingAppointments = await appointmentModel.find({
    //   employee,
    //   $or: [
    //     { startDate: { $lt: endDate, $gte: startDate } },
    //     { endDate: { $gt: startDate, $lte: endDate } },
    //     { startDate: { $lte: startDate }, endDate: { $gte: endDate } },
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

    // Crear la cita
    const newAppointment = new appointmentModel({
      service,
      employee,
      employeeRequestedByClient,
      client,
      startDate,
      endDate,
      organizationId,
      advancePayment,
      customPrice,
      additionalItems,
      totalPrice, // Asignar precio total calculado
    });

    // Formatear fecha para la confirmación
    const dateObject = new Date(startDate);

    const appointmentDate = new Intl.DateTimeFormat("es-ES", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/Bogota",
    }).format(dateObject);

    // Obtener detalles de la organización
    const organization = await organizationService.getOrganizationById(
      organizationId
    );

    const appointmentDetails = {
      names: client?.name || "Estimado cliente",
      date: appointmentDate,
      organization: organization.name,
      service: serviceDetails.name,
      employee: employee.names,
      phoneNumber: organization.phoneNumber,
    };

    // Enviar confirmación por WhatsApp
    try {
      const msg = whatsappTemplates.scheduleAppointment(appointmentDetails);

      await whatsappService.sendMessage(
        organizationId,
        client?.phoneNumber,
        msg
      );
    } catch (error) {
      console.error(
        `Error enviando la confirmación para ${client?.phoneNumber}:`,
        error.message
      );
    }

    // Guardar la cita en la base de datos
    return await newAppointment.save();
  },

  // Crear múltiples citas (batch)
  createAppointmentsBatch: async (payload) => {
    const {
      services,
      employee,
      employeeRequestedByClient,
      client,
      startDate,
      organizationId,
      advancePayment,
      customPrices = {},
      additionalItemsByService = {},
    } = payload;
    
    if (!Array.isArray(services) || services.length === 0) {
      throw new Error("Debe enviar al menos un servicio.");
    }
    if (!employee || !client || !startDate || !organizationId) {
      throw new Error("Faltan datos requeridos para crear las citas.");
    }

    const org = await organizationService.getOrganizationById(organizationId);
    if (!org) throw new Error("Organización no encontrada.");

    const session = await mongoose.startSession();
    let committed = false;

    const created = [];
    const groupId = new mongoose.Types.ObjectId();

    try {
      session.startTransaction();

      // Interpretar la fecha/hora en la zona horaria de la organización
      const timezone = org.timezone || 'America/Bogota';
      let currentStart = moment.tz(startDate, 'YYYY-MM-DDTHH:mm:ss', timezone).toDate();

      for (const serviceId of services) {
        const svc = await serviceService.getServiceById(serviceId);
        if (!svc) throw new Error(`Servicio no encontrado: ${serviceId}`);

        const duration = svc.duration ?? 0; // en minutos
        const serviceEnd = new Date(currentStart.getTime() + duration * 60000);

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

        const doc = new appointmentModel({
          groupId,
          service: serviceId,
          employee,
          employeeRequestedByClient: !!employeeRequestedByClient,
          client,
          startDate: currentStart,
          endDate: serviceEnd,
          organizationId,
          advancePayment,
          customPrice: customPrices[serviceId],
          additionalItems,
          totalPrice,
          status: "pending",
        });

        const saved = await doc.save({ session });
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
      if (created.length > 0) {
        const first = created[0];
        const last = created[created.length - 1];

        const dateRange =
          created.length === 1
            ? fmt(first.start)
            : `${fmt(first.start)} – ${fmtTime(last.end)}`;

        const servicesForMsg = created.map((c) => ({
          name: c.svc.name,
          start: fmtTime(c.start),
          end: fmtTime(c.end),
        }));

        // Cargar cliente/empleado si vinieron como IDs
        const clientDoc =
          typeof client === "string"
            ? await clientService.getClientById(client)
            : client;
        const employeeDoc =
          typeof employee === "string"
            ? await employeeService.getEmployeeById(employee)
            : employee;


        const rawPhone = clientDoc?.phoneNumber;

        // 1) validar con tu hasUsablePhone (retorna "57XXXXXXXXXX" o null)
        const usable = hasUsablePhone(rawPhone);
        if (!usable) {
          console.warn(
            "Cliente sin teléfono utilizable; no se enviará WhatsApp."
          );
          return created.map((c) => c.saved);
        }

        // 2) normalizar a E.164 (+57XXXXXXXXXX) para el envío 1-a-1
        //    Si tu wa-backend acepta también "57XXXXXXXXXX", podrías usar `usable` directo.
        const phoneE164 = hasUsablePhone(rawPhone) || `+${usable}`;

        // Armar mensaje final con tu template existente
        const msg = whatsappTemplates.scheduleAppointmentBatch({
          names: clientDoc?.name || "Estimado cliente",
          dateRange,
          organization: org.name,
          services: servicesForMsg, // [{ name, start, end }]
          employee: employeeDoc?.names || "Nuestro equipo",
        });

        // Envío 1-a-1 (mensaje ya renderizado)
        await waIntegrationService.sendMessage({
          orgId: organizationId,
          phone: phoneE164,
          message: msg,
          image: null,
        });
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

      // Añadir rango de fechas al query
      query.startDate = { $gte: new Date(startDate) };
      query.endDate = { $lte: new Date(endDate) };

      // ✅ Filtrar por empleados específicos si se proporcionan
      if (employeeIds && Array.isArray(employeeIds) && employeeIds.length > 0) {
        query.employee = { $in: employeeIds };
      }

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

  // Obtener las citas de un empleado
  getAppointmentsByClient: async (client) => {
    return await appointmentModel
      .find({ client })
      .populate("service")
      .populate("employee")
      .exec();
  },

  // Reemplaza tu updateAppointment por este
  updateAppointment: async (id, updatedData) => {
    const appt = await appointmentModel.findById(id);
    if (!appt) throw new Error("Cita no encontrada");

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
      ? new Date(updatedData.startDate)
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
    //    - Si cambió el servicio → usar la duración del nuevo servicio
    //    - Si no cambió pero llegó startDate → mantener la misma duración anterior
    //      (duración = appt.endDate - appt.startDate)
    let newEnd;
    if (serviceChanged) {
      const durationMin = Number(svc.duration ?? 0);
      newEnd = new Date(newStart.getTime() + durationMin * 60000);
    } else if (updatedData.startDate) {
      const prevDurationMs =
        new Date(appt.endDate).getTime() - new Date(appt.startDate).getTime();
      newEnd = new Date(newStart.getTime() + Math.max(prevDurationMs, 0));
    } else {
      // No cambió servicio ni startDate → endDate queda igual salvo que FE lo envíe
      newEnd = updatedData.endDate
        ? new Date(updatedData.endDate)
        : new Date(appt.endDate);
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
    const passthrough = ["status", "notes", "source", "meta"];
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
      const orgsWithReminders = organizations.filter(
        (org) => org.reminderSettings?.enabled !== false
      );

      if (!orgsWithReminders.length) {
        console.log("[Reminders] No hay organizaciones con recordatorios habilitados.");
        return;
      }

      // Obtener hora actual en Colombia
      const now = new Date();
      const nowColombia = new Date(now.toLocaleString("en-US", { timeZone: "America/Bogota" }));
      const currentHour = nowColombia.getHours();
      const currentMinute = nowColombia.getMinutes();

      let totalOk = 0;
      let totalSkipped = 0;

      // Procesar cada organización
      for (const org of orgsWithReminders) {
        const orgId = org._id.toString();
        const hoursBefore = org.reminderSettings?.hoursBefore || 24;
        const sendTimeStart = org.reminderSettings?.sendTimeStart || "07:00";
        const sendTimeEnd = org.reminderSettings?.sendTimeEnd || "20:00";

        // Parsear horas del rango permitido
        const [startHour, startMinute] = sendTimeStart.split(":").map(Number);
        const [endHour, endMinute] = sendTimeEnd.split(":").map(Number);

        // Verificar si estamos dentro del rango horario permitido
        const currentTimeMinutes = currentHour * 60 + currentMinute;
        const startTimeMinutes = startHour * 60 + startMinute;
        const endTimeMinutes = endHour * 60 + endMinute;

        if (currentTimeMinutes < startTimeMinutes || currentTimeMinutes > endTimeMinutes) {
          // Fuera del rango horario permitido para esta organización
          continue;
        }

        // Calcular ventana de tiempo: buscar citas que necesitan recordatorio en esta hora
        // Ventana de 1 hora completa para capturar citas a cualquier minuto (8:00, 8:15, 8:30, 8:45, etc.)
        const targetTimeStart = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000);
        const targetTimeEnd = new Date(now.getTime() + (hoursBefore + 1) * 60 * 60 * 1000);

        // Buscar citas que estén en la ventana de tiempo objetivo y no tengan recordatorio enviado
        const appointmentsInWindow = await appointmentModel
          .find({
            organizationId: orgId,
            startDate: { $gte: targetTimeStart, $lt: targetTimeEnd },
            reminderSent: false,
          })
          .populate("client")
          .populate("service")
          .populate("employee")
          .populate("organizationId");

        if (!appointmentsInWindow.length) {
          continue; // No hay citas en este momento para esta organización
        }

        // Obtener todos los clientes únicos que tienen citas en esta ventana
        const clientIds = [...new Set(
          appointmentsInWindow
            .map(appt => appt.client?._id?.toString())
            .filter(Boolean)
        )];

        // Obtener el rango del día completo para las citas encontradas
        // Usar la timezone de la organización
        const timezone = org.timezone || 'America/Bogota';
        const targetDateStr = moment.tz(targetTimeStart, timezone).format('YYYY-MM-DD');
        const dayStart = moment.tz(targetDateStr, timezone).startOf('day').toDate();
        const dayEnd = moment.tz(targetDateStr, timezone).endOf('day').toDate();

        // Buscar TODAS las citas del día para estos clientes (no solo de esta hora)
        const appointments = await appointmentModel
          .find({
            organizationId: orgId,
            client: { $in: clientIds },
            startDate: { $gte: dayStart, $lt: dayEnd },
            reminderSent: false,
          })
          .populate("client")
          .populate("service")
          .populate("employee")
          .populate("organizationId");

        if (!appointments.length) {
          continue;
        }

        console.log(`[${org.name}] Procesando ${appointments.length} citas para recordatorio vía campaña`);

        // Verificar sesión de WhatsApp
        const orgClientId = org.clientIdWhatsapp;
        if (!orgClientId) {
          console.warn(
            `[${org.name}] Sin clientIdWhatsapp. Se omiten ${appointments.length} recordatorios.`
          );
          totalSkipped += appointments.length;
          continue;
        }

        // Agrupar por teléfono (cliente) - el servicio de campaña ya lo hace, 
        // pero necesitamos preparar los items
        const byPhone = new Map();
        const fmtHour = new Intl.DateTimeFormat("es-ES", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
          timeZone: "America/Bogota",
        });
        const fmtDay = new Intl.DateTimeFormat("es-ES", {
          day: "numeric",
          month: "long",
          timeZone: "America/Bogota",
        });

        for (const appt of appointments) {
          const phone = hasUsablePhone(appt?.client?.phoneNumber);
          if (!phone) continue;

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
            });
          }

          const bucket = byPhone.get(phone);
          bucket.services.push({ name: serviceName, time: timeLabel });
          if (start < bucket.firstStart) bucket.firstStart = start;
          if ((end || start) > bucket.lastEnd) bucket.lastEnd = end || start;
          if (appt?.employee?.names) bucket.employees.add(appt.employee.names);
          bucket.apptIds.add(String(appt._id));
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
              ? `${fmtDay.format(bucket.firstStart)} ${fmtHour.format(
                  bucket.firstStart
                )}`
              : `${fmtDay.format(bucket.firstStart)} ${fmtHour.format(
                  bucket.firstStart
                )} – ${fmtHour.format(bucket.lastEnd)}`;

          const countNum = bucket.services.length;
          const isSingle = countNum === 1;

          const vars = {
            names: bucket.names,
            date_range: dateRange,
            organization: org.name || "",
            services_list: servicesList,
            employee: Array.from(bucket.employees).join(", "),
            count: String(countNum),
            cita_pal: isSingle ? "cita" : "citas",
            agendada_pal: isSingle ? "agendada" : "agendadas",
          };

          items.push({ phone: bucket.phone, vars });
          includedIds.push(...Array.from(bucket.apptIds));
        }

        if (!items.length) {
          console.log(`[${org.name}] No hay items válidos (teléfonos).`);
          continue;
        }

        // Enviar campaña
        try {
          const targetDateStr = targetTimeStart.toISOString().slice(0, 10);
          const title = `Recordatorios ${targetDateStr} ${currentHour}:00 (${org.name})`;

          const { waBulkSend, waBulkOptIn } = await import("./waHttpService.js");
          const { messageTplReminder } = await import("../utils/bulkTemplates.js");

          // Opcional: sincronizar opt-in
          try {
            await waBulkOptIn(items.map((it) => it.phone));
          } catch (e) {
            console.warn(`[${org.name}] OptIn falló: ${e?.message || e}`);
          }

          const result = await waBulkSend({
            clientId: orgClientId,
            title,
            items,
            messageTpl: messageTplReminder,
            dryRun: false,
          });

          console.log(
            `[${org.name}] Campaña enviada: ${result.prepared} mensajes (bulkId: ${result.bulkId})`
          );

          // Marcar citas como enviadas
          if (includedIds.length) {
            await appointmentModel.updateMany(
              { _id: { $in: includedIds } },
              { $set: { reminderSent: true, reminderBulkId: result.bulkId } }
            );
          }

          totalOk += includedIds.length;

          // Pequeño respiro entre organizaciones
          await sleep(300);
        } catch (err) {
          console.error(
            `[${org.name}] Error enviando campaña:`,
            err.message
          );
          totalSkipped += appointments.length;
        }
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
};

export default appointmentService;
