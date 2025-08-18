import appointmentModel from "../models/appointmentModel.js";
import organizationService from "./organizationService.js";
import serviceService from "./serviceService.js";
import whatsappService from "./sendWhatsappService.js";
import whatsappTemplates from "../utils/whatsappTemplates.js";
// Helpers locales
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Valida que haya dígitos suficientes (tu whatsappService.formatPhone ya normaliza)
// Aquí solo filtramos vacíos o absurdamente cortos.
const hasUsablePhone = (phone) => {
  if (!phone) return false;
  const digits = String(phone).replace(/\D/g, "");
  return digits.length >= 8; // ajusta si quieres ser más estricto (10)
};

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
    const ADMIN_PHONE = "+573132735116"; // E.164 (con +)

    const fmtBogota = (date) =>
      new Intl.DateTimeFormat("es-ES", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "America/Bogota",
      }).format(date);

    try {
      // Ventana: todo el día de hoy en Bogotá
      const nowUtc = Date.now();
      const bogotaNow = new Date(nowUtc - 5 * 60 * 60 * 1000); // Bogotá = UTC-5
      const y = bogotaNow.getUTCFullYear();
      const m = bogotaNow.getUTCMonth();
      const d = bogotaNow.getUTCDate();

      const startUTC = new Date(Date.UTC(y, m, d, 5, 0, 0, 0)); // 00:00 BOG = 05:00 UTC
      const endUTC = new Date(Date.UTC(y, m, d + 1, 4, 59, 59, 999)); // 23:59:59.999 BOG = 04:59:59.999 UTC (+1)

      const appointments = await appointmentModel
        .find({
          startDate: { $gte: startUTC, $lt: endUTC },
          reminderSent: false,
        })
        .populate("client")
        .populate("service")
        .populate("employee")
        .populate("organizationId");

      // Agrupar por organización
      const byOrg = new Map();
      for (const appt of appointments) {
        const orgId = appt.organizationId?._id?.toString();
        if (!orgId) continue;
        if (!byOrg.has(orgId)) byOrg.set(orgId, []);
        byOrg.get(orgId).push(appt);
      }

      let totalOk = 0;
      let totalFail = 0;

      if (byOrg.size === 0) {
        console.log("No hay citas para enviar recordatorios hoy.");

        // Aviso opcional si defines ADMIN_ORG_ID en .env
        if (process.env.ADMIN_ORG_ID) {
          try {
            await whatsappService.sendMessage(
              process.env.ADMIN_ORG_ID,
              ADMIN_PHONE,
              `ℹ️ No hay citas para enviar hoy.\nRango Bogotá: ${fmtBogota(
                startUTC
              )} a ${fmtBogota(endUTC)}`
            );
          } catch (e) {
            console.error("Error enviando aviso 'sin citas':", e.message);
          }
        }
        return;
      }

      // Procesar por organización
      for (const [orgId, appts] of byOrg.entries()) {
        // Aviso de inicio por org
        try {
          await whatsappService.sendMessage(
            orgId,
            ADMIN_PHONE,
            `▶️ Iniciando envío de recordatorios.\nRango Bogotá: ${fmtBogota(
              startUTC
            )} a ${fmtBogota(endUTC)}\nCitas encontradas: ${appts.length}`
          );
        } catch (e) {
          console.error(
            "Error enviando aviso de inicio (org:",
            orgId,
            "):",
            e.message
          );
        }

        let ok = 0;
        let fail = 0;

        for (const appointment of appts) {
          // Validación rápida de teléfono
          const rawPhone = appointment?.client?.phoneNumber;
          if (!hasUsablePhone(rawPhone)) {
            fail++;
            console.warn(
              `⚠️ Teléfono inválido/ausente para cliente '${
                appointment?.client?.name || "Desconocido"
              }' (org ${orgId}).`
            );
            continue;
          }

          // Fecha amigable
          const appointmentDateTime = new Intl.DateTimeFormat("es-ES", {
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
            timeZone: "America/Bogota",
          }).format(new Date(appointment.startDate));

          // Detalles a prueba de undefined
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
            await whatsappService.sendMessage(
              orgId, // ← mismo organizationId
              rawPhone,
              msg
            );

            appointment.reminderSent = true;
            await appointment.save();
            ok++;
            totalOk++;
          } catch (e) {
            fail++;
            totalFail++;
            console.error(
              `Error enviando recordatorio a ${rawPhone} (org ${orgId}):`,
              e.message
            );
          }

          // Pequeño respiro para no saturar
          await sleep(150);
        }

        // Aviso de fin por org
        try {
          await whatsappService.sendMessage(
            orgId,
            ADMIN_PHONE,
            `✅ Finalizado envío de recordatorios.\nÉxitos: ${ok}\nFallos: ${fail}\nTotal procesadas: ${appts.length}`
          );
        } catch (e) {
          console.error(
            "Error enviando aviso de fin (org:",
            orgId,
            "):",
            e.message
          );
        }
      }

      // Resumen global (opcional)
      console.log(
        `📊 Resumen global recordatorios — OK: ${totalOk} | Fallos: ${totalFail} | Total: ${
          totalOk + totalFail
        }`
      );

      // Aviso global opcional al admin
      if (process.env.ADMIN_ORG_ID) {
        try {
          await whatsappService.sendMessage(
            process.env.ADMIN_ORG_ID,
            ADMIN_PHONE,
            `📊 Resumen global recordatorios\nOK: ${totalOk}\nFallos: ${totalFail}\nTotal: ${
              totalOk + totalFail
            }`
          );
        } catch (e) {
          console.error("Error enviando resumen global al admin:", e.message);
        }
      }
    } catch (e) {
      console.error("Error ejecutando sendDailyReminders:", e.message);

      // Aviso de error fatal (usa ADMIN_ORG_ID si lo tienes configurado)
      if (process.env.ADMIN_ORG_ID) {
        try {
          await whatsappService.sendMessage(
            process.env.ADMIN_ORG_ID,
            ADMIN_PHONE,
            `⛔ Error en sendDailyReminders: ${e.message}`
          );
        } catch (e2) {
          console.error("Además falló el aviso admin:", e2.message);
        }
      }
    }
  },
};

export default appointmentService;
