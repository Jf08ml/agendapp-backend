import appointmentModel from "../models/appointmentModel.js";
import organizationService from "./organizationService.js";
import serviceService from "./serviceService.js";
import whatsappService from "./sendWhatsappService.js";
import whatsappTemplates from "../utils/whatsappTemplates.js";
import clientService from "../services/clientService.js"
import employeeService from "../services/employeeService.js";
import mongoose from "mongoose";

// Utilidades mínimas (si ya las tienes, quítalas de aquí)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hasUsablePhone = (p) => !!String(p || "").replace(/\D/g, "").length;

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

    // Variables para uso posterior (fuera de la TX)
    const created = [];
    const groupId = new mongoose.Types.ObjectId();

    try {
      session.startTransaction();

      let currentStart = new Date(startDate);

      for (const serviceId of services) {
        const svc = await serviceService.getServiceById(serviceId);
        if (!svc) throw new Error(`Servicio no encontrado: ${serviceId}`);

        const duration = svc.duration ?? 0; // minutos
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
        currentStart = serviceEnd; // siguiente inicia donde terminó este
      }

      // (Opcional) validación de solapes a nivel batch aquí…

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

        const servicesForMsg = created.map((c, i) => ({
          name: c.svc.name,
          start: fmtTime(c.start),
          end: fmtTime(c.end),
        }));

        // 🔹 Cargar cliente/empleado cuando son IDs
        const clientDoc =
          typeof client === "string"
            ? await clientService.getClientById(client)
            : client;
        const employeeDoc =
          typeof employee === "string"
            ? await employeeService.getEmployeeById(employee)
            : employee;

        const phone = clientDoc?.phoneNumber;
        if (!hasUsablePhone(phone)) {
          console.warn(
            "Cliente sin teléfono utilizable; no se enviará WhatsApp."
          );
          return created.map((c) => c.saved);
        }

        const msg = whatsappTemplates.scheduleAppointmentBatch({
          names: clientDoc?.name || "Estimado cliente",
          dateRange,
          organization: org.name,
          services: servicesForMsg,
          employee: employeeDoc?.names || "Nuestro equipo",
        });

        // await whatsappService.sendMessage(organizationId, phone, msg, null, {
        //   longTimeout: true,
        // });
      }
    } catch (error) {
      // Importante: NO intentes abortar/commit aquí; la TX ya terminó.
      console.error(
        `Error enviando la confirmación batch a ${client?.phoneNumber}:`,
        error.message
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
    endDate
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

  // Actualizar una cita
  updateAppointment: async (id, updatedData) => {
    const appointment = await appointmentModel.findById(id);

    if (!appointment) {
      throw new Error("Cita no encontrada");
    }

    const { employee, startDate, endDate } = updatedData;

    // Validar citas superpuestas
    // if (employee && startDate && endDate) {
    //   const overlappingAppointments = await appointmentModel.find({
    //     employee,
    //     _id: { $ne: id }, // Excluir la cita actual
    //     $or: [
    //       { startDate: { $lt: endDate, $gte: startDate } },
    //       { endDate: { $gt: startDate, $lte: endDate } },
    //       { startDate: { $lte: startDate }, endDate: { $gte: endDate } },
    //     ],
    //   });

    //   if (overlappingAppointments.length > 0) {
    //     throw new Error(
    //       "El empleado tiene citas que se cruzan en el horario seleccionado"
    //     );
    //   }
    // }

    // Actualizar los datos de la cita
    appointment.set(updatedData);
    return await appointment.save();
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
      const { dayStartUTC, dayEndUTC } = getBogotaTodayWindowUTC();

      // 1) Todas las citas de HOY (Bogotá), sin recordatorio enviado aún
      const appointments = await appointmentModel
        .find({
          startDate: { $gte: dayStartUTC, $lt: dayEndUTC },
          reminderSent: false,
        })
        .populate("client")
        .populate("service")
        .populate("employee")
        .populate("organizationId");

      if (!appointments.length) {
        console.log("[Reminders] No hay citas hoy.");
        return;
      }

      // 2) Agrupar por organización
      const byOrg = new Map();
      for (const a of appointments) {
        const orgId = a?.organizationId?._id?.toString();
        if (!orgId) continue;
        if (!byOrg.has(orgId)) byOrg.set(orgId, []);
        byOrg.get(orgId).push(a);
      }

      let totalOk = 0;
      let totalFail = 0;

      // 3) Procesar por organización (secuencial por org para no saturar)
      for (const [orgId, appts] of byOrg.entries()) {
        const orgClientId = appts[0]?.organizationId?.clientIdWhatsapp;
        if (
          !orgClientId ||
          !(await whatsappService.isClientReady(orgClientId))
        ) {
          console.warn(
            `[${orgId}] Sesión WA no lista. Se omiten ${appts.length} recordatorios.`
          );
          continue;
        }

        let ok = 0;
        let fail = 0;

        for (const appointment of appts) {
          const rawPhone = appointment?.client?.phoneNumber;
          if (!hasUsablePhone(rawPhone)) {
            fail++;
            continue;
          }

          // Fecha legible en Bogotá
          const appointmentDateTime = new Intl.DateTimeFormat("es-ES", {
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
            timeZone: "America/Bogota",
          }).format(new Date(appointment.startDate));

          const details = {
            names: appointment?.client?.name || "Cliente",
            date: appointmentDateTime,
            organization: appointment?.organizationId?.name || "",
            employee: appointment?.employee?.names || "",
            service: appointment?.service
              ? `${appointment.service.type || ""} - ${
                  appointment.service.name || ""
                }`.trim()
              : "",
            phoneNumber: appointment?.organizationId?.phoneNumber || "",
          };

          try {
            const msg = whatsappTemplates.reminder(details);
            await whatsappService.sendMessage(orgId, rawPhone, msg, null, {
              longTimeout: true,
            });
            appointment.reminderSent = true;
            await appointment.save();
            ok++;
            totalOk++;
          } catch (err) {
            console.error(
              `[${orgId}] Error enviando a ${rawPhone}:`,
              err.message
            );
            fail++;
            totalFail++;
          }

          // Pequeño respiro para no saturar la sesión/cola
          await sleep(150);
        }

        console.log(
          `[${orgId}] Finalizado: OK=${ok} | Fail=${fail} | Total=${appts.length}`
        );
      }

      console.log(
        `[Reminders] Global — OK=${totalOk} | Fail=${totalFail} | Total=${
          totalOk + totalFail
        }`
      );
    } catch (e) {
      console.error("Error en sendDailyReminders:", e.message);
    }
  },
};

export default appointmentService;
