import mongoose from "mongoose";
import moment from 'moment-timezone';
import serviceModel from "../models/serviceModel.js";
import notificationService from "../services/notificationService.js";
import organizationService from "../services/organizationService.js";
import reservationService from "../services/reservationService.js";
import appointmentService from "../services/appointmentService.js";
import subscriptionService from "../services/subscriptionService.js";
import sendResponse from "../utils/sendResponse.js";
import employeeService from "../services/employeeService.js";
import scheduleService from "../services/scheduleService.js";
import employeeModel from "../models/employeeModel.js";
import { generateCancellationLink } from "../utils/cancellationUtils.js";

// ---------------------- helpers de notificación ----------------------
async function notifyNewBooking(org, customerDetails, { isAuto, multi }) {
  const title = isAuto
    ? "Nueva cita automática"
    : multi
    ? "Nueva reserva múltiple"
    : "Nueva reserva";

  const message = isAuto
    ? `Se crearon citas automáticas para ${customerDetails.name}`
    : multi
    ? `Tienes nuevas reservas de ${customerDetails.name}`
    : `Tienes una nueva reserva pendiente por confirmar de ${customerDetails.name}`;

  try {
    await notificationService.createNotification({
      title,
      message,
      organizationId: org._id,
      type: "reservation",
      frontendRoute: isAuto ? `/agenda` : `/gestionar-reservas-online`,
      status: "unread",
    });

    await subscriptionService.sendNotificationToUser(
      org._id,
      JSON.stringify({
        title,
        message,
        icon: org?.branding?.pwaIcon,
      })
    );
  } catch (e) {
    console.warn(
      "[notifyNewBooking] Error enviando notificaciones:",
      e?.message || e
    );
  }
}

const reservationController = {
  // Crear una nueva reserva (single)
  createReservation: async (req, res) => {
    const {
      serviceId,
      employeeId,
      startDate,
      customerDetails,
      organizationId,
    } = req.body;

    try {
      // Org y política
      const org = await organizationService.getOrganizationById(organizationId);
      if (!org)
        return sendResponse(res, 404, null, "Organización no encontrada");
      const policy = org.reservationPolicy || "manual";

      // 🕒 VALIDAR HORARIO DE DISPONIBILIDAD
      const timezone = org.timezone || 'America/Bogota';
      // 🔧 FIX: Parsear con formato explícito para que moment interprete como tiempo LOCAL
      // startDate viene en formato "YYYY-MM-DDTHH:mm:ss" y representa tiempo local en la timezone
      const requestedDateTime = moment.tz(startDate, 'YYYY-MM-DDTHH:mm:ss', timezone).toDate();
      
      // Validar empleado si fue especificado
      let employee = null;
      if (employeeId) {
        employee = await employeeModel.findById(employeeId);
        if (!employee) {
          return sendResponse(res, 404, null, "Empleado no encontrado");
        }
      }

      // Validar que la fecha/hora esté dentro de los horarios permitidos
      const scheduleValidation = scheduleService.validateDateTime(
        requestedDateTime,
        org,
        employee
      );

      if (!scheduleValidation.valid) {
        return sendResponse(res, 400, null, scheduleValidation.reason);
      }

      // ✅ VALIDAR DISPONIBILIDAD DEL SLOT (evitar race conditions)
      if (employee) {
        const service = await serviceModel.findById(serviceId);
        if (!service) {
          return sendResponse(res, 404, null, "Servicio no encontrado");
        }

        // Obtener citas del día
        const dateStr = moment.tz(startDate, 'YYYY-MM-DDTHH:mm:ss', timezone).format('YYYY-MM-DD');
        const startOfDay = moment.tz(dateStr, timezone).startOf('day').toDate();
        const endOfDay = moment.tz(dateStr, timezone).endOf('day').toDate();

        const dayAppointments = await appointmentService.getAppointmentsByOrganizationWithDates(
          organizationId,
          startOfDay.toISOString(),
          endOfDay.toISOString(),
          [employeeId]
        );

        // Generar slots disponibles
        const availableSlots = scheduleService.generateAvailableSlots(
          requestedDateTime,
          org,
          employee,
          service.duration,
          dayAppointments
        );

        const requestedTimeInTz = moment.tz(requestedDateTime, timezone);
        const requestedTime = requestedTimeInTz.format('HH:mm');
        const slotAvailable = availableSlots.find(s => s.time === requestedTime && s.available);

        if (!slotAvailable) {
          return sendResponse(res, 409, null, "El horario seleccionado ya no está disponible");
        }
      }

      // Cliente (asegurar)
      const customer = await reservationService.ensureClientExists({
        name: customerDetails.name,
        phoneNumber: customerDetails.phone,
        email: customerDetails.email,
        organizationId,
        birthDate: customerDetails.birthDate,
      });

      // === AUTO: intentar crear cita batch con un solo servicio
      if (policy === "auto_if_available") {
        if (employeeId) {
          try {
            const appointments =
              await appointmentService.createAppointmentsBatch({
                services: [serviceId],
                employee: employeeId,
                employeeRequestedByClient: true,
                client: customer._id,
                startDate,
                organizationId,
              });

            await notifyNewBooking(org, customerDetails, {
              isAuto: true,
              multi: false,
            });
            return sendResponse(
              res,
              201,
              { policy, outcome: "approved_and_appointed", appointments },
              "Cita creada automáticamente"
            );
          } catch (e) {
            // cae a reserva pending si no hay disponibilidad o falla
          }
        }
        // Sin empleado o fallo al auto-agendar → reserva pending
      }

      // === MANUAL (o AUTO que cayó) → crear reserva pendiente
      const newReservation = await reservationService.createReservation({
        serviceId,
        employeeId: employeeId || null,
        startDate,
        customer: customer._id,
        customerDetails,
        organizationId,
        status: "pending",
      });

      // 🔗 Generar link de cancelación si hay token
      let cancellationLink = null;
      if (newReservation._cancelToken) {
        cancellationLink = generateCancellationLink(newReservation._cancelToken, org);
      }

      await notifyNewBooking(org, customerDetails, {
        isAuto: false,
        multi: false,
      });

      return sendResponse(
        res,
        201,
        { 
          policy, 
          outcome: "pending", 
          reservation: newReservation,
          cancellationLink, // Incluir link en respuesta
        },
        "Reserva creada exitosamente"
      );
    } catch (error) {
      return sendResponse(
        res,
        500,
        null,
        `Error al crear la reserva: ${error.message}`
      );
    }
  },

  // POST /api/reservations/multi
  createMultipleReservations: async (req, res) => {
    const { services, startDate, customerDetails, organizationId } = req.body;

    if (!services || !Array.isArray(services) || services.length === 0) {
      return sendResponse(res, 400, null, "Debe enviar al menos un servicio.");
    }
    if (
      !startDate ||
      !customerDetails?.name ||
      !customerDetails?.phone ||
      !organizationId
    ) {
      return sendResponse(
        res,
        400,
        null,
        "Datos incompletos para crear reservas."
      );
    }

    try {
      // Org y política
      const org = await organizationService.getOrganizationById(organizationId);
      if (!org)
        return sendResponse(res, 404, null, "Organización no encontrada");
      const policy = org.reservationPolicy || "manual";
      
      // Obtener la zona horaria de la organización
      const timezone = org.timezone || 'America/Bogota';

      // Cliente (asegurar)
      const customer = await reservationService.ensureClientExists({
        name: customerDetails.name,
        phoneNumber: customerDetails.phone,
        email: customerDetails.email,
        organizationId,
        birthDate: customerDetails.birthDate,
      });

      // === AUTO: crear citas batch (una sola transacción/mensaje)
      const normalizeId = (v) =>
        typeof v === "object" && v !== null ? v._id?.toString() : v?.toString();

      // === AUTO: crear citas batch por empleado (grupos contiguos) y reservas auto-aprobadas
      if (policy === "auto_if_available") {
        try {
          // 1) Validaciones mínimas
          if (!Array.isArray(services) || services.length === 0) {
            return sendResponse(
              res,
              400,
              null,
              "Debe enviar al menos un servicio."
            );
          }
          // Cada item debe traer employeeId para poder agendar de una vez
          if (services.some((s) => !s.employeeId)) {
            // Puedes elegir: (a) caer a pending, (b) error 400. Aquí aviso claro:
            return sendResponse(
              res,
              400,
              null,
              "Para auto-reserva, cada servicio debe tener un empleado asignado."
            );
          }

          // 2) Normalizar duraciones y calcular startDate encadenado por servicio
          // 🔧 FIX: Mantener como STRING ISO sin timezone para evitar conversiones
          let cursorMoment = moment.tz(startDate, 'YYYY-MM-DDTHH:mm:ss', timezone);
          
          const normalized = [];
          for (const item of services) {
            let duration = item.duration;
            if (!duration) {
              const svcObj = await serviceModel.findById(item.serviceId);
              if (!svcObj) throw new Error("Servicio no encontrado");
              duration = Number(svcObj.duration || 0);
            }
            // Generar string ISO sin timezone
            const itemStart = cursorMoment.format('YYYY-MM-DDTHH:mm:ss');
            cursorMoment = cursorMoment.clone().add(duration, 'minutes');

            normalized.push({
              serviceId: item.serviceId,
              employeeId: normalizeId(item.employeeId),
              startDate: itemStart,
              duration,
            });
          }

          // 3) Generar UN groupId y token compartido para TODAS las citas
          const mongoose = (await import('mongoose')).default;
          const cancellationService = (await import('../services/cancellationService.js')).default;
          
          const sharedGroupId = new mongoose.Types.ObjectId();
          const { token: sharedToken, hash: sharedTokenHash } = cancellationService.generateCancelToken();
          console.log('🔑 Token compartido generado para reserva múltiple:', sharedGroupId);
          
          const allServiceIds = normalized.map(n => n.serviceId);
          const allAppointments = [];
          
          // Agrupar por empleado para crear en batches (pero sin enviar mensaje aún)
          const employeeGroups = new Map();
          normalized.forEach((n, idx) => {
            if (!employeeGroups.has(n.employeeId)) {
              employeeGroups.set(n.employeeId, []);
            }
            employeeGroups.get(n.employeeId).push({ ...n, originalIndex: idx });
          });

          // Crear citas por grupo de empleado, pasando el groupId y token compartido
          for (const [employeeId, group] of employeeGroups.entries()) {
            const batch = await appointmentService.createAppointmentsBatch({
              services: group.map(g => g.serviceId),
              employee: employeeId,
              employeeRequestedByClient: true,
              client: normalizeId(customer),
              startDate: group[0].startDate,
              organizationId: normalizeId(organizationId),
              skipNotification: true, // 🔇 No enviar mensaje aún
              sharedGroupId, // 🔗 Mismo groupId para todas las citas
              sharedTokenHash, // 🔗 Mismo token hash para todas las citas
            });

            // Mapear las citas creadas a sus índices originales
            group.forEach((item, idx) => {
              allAppointments[item.originalIndex] = batch[idx];
            });
          }

          // 5) Crear Reservations auto-aprobadas y (opcional) enlazar appointmentId
          // 👥 Generar UN groupId para todas las reservas de esta solicitud múltiple
          const reservationGroupId = new mongoose.Types.ObjectId();
          console.log(`👥 GroupId para reservas múltiples: ${reservationGroupId}`);
          
          const createdReservations = [];
          for (let i = 0; i < normalized.length; i++) {
            const n = normalized[i];
            const appt = allAppointments[i];

            console.log(`📋 Creando reserva ${i + 1}/${normalized.length}, appointmentId: ${appt?._id}`);

            const reservationData = {
              serviceId: n.serviceId,
              employeeId: n.employeeId,
              startDate: n.startDate,
              customer: normalizeId(customer),
              customerDetails,
              organizationId: normalizeId(organizationId),
              status: "auto_approved",
              auto: true,
              appointmentId: appt?._id || null,
              groupId: reservationGroupId, // 👥 Asignar el mismo groupId a todas
            };

            const newReservation = await reservationService.createReservation(
              reservationData
            );
            console.log(`✅ Reserva creada: ${newReservation._id}, appointmentId: ${newReservation.appointmentId}, groupId: ${newReservation.groupId}`);
            createdReservations.push(newReservation);
          }

          // 6) Enviar UN SOLO mensaje de WhatsApp con todas las citas
          try {
            const serviceModel = (await import('../models/serviceModel.js')).default;
            const employeeModel = (await import('../models/employeeModel.js')).default;
            const whatsappTemplates = (await import('../utils/whatsappTemplates.js')).default;
            const { waIntegrationService } = await import('../services/waIntegrationService.js');
            const { hasUsablePhone } = await import('../utils/timeAndPhones.js');
            
            // Obtener detalles de servicios y empleados
            const servicesDetails = await Promise.all(
              allAppointments.map(apt => serviceModel.findById(apt.service))
            );
            
            const employeesMap = new Map();
            for (const apt of allAppointments) {
              if (!employeesMap.has(apt.employee.toString())) {
                const emp = await employeeModel.findById(apt.employee);
                employeesMap.set(apt.employee.toString(), emp);
              }
            }

            // Formatear servicios para el mensaje
            const fmtTime = (d, tz = timezone) =>
              new Intl.DateTimeFormat("es-ES", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: true,
                timeZone: tz,
              }).format(new Date(d));

            const servicesForMsg = allAppointments.map((apt, idx) => ({
              name: servicesDetails[idx]?.name || 'Servicio',
              start: fmtTime(apt.startDate, timezone),
              end: fmtTime(apt.endDate, timezone),
              employee: employeesMap.get(apt.employee.toString())?.names || 'Empleado',
            }));

            const firstStart = allAppointments[0].startDate;
            const lastEnd = allAppointments[allAppointments.length - 1].endDate;
            
            const fmt = (d, tz = timezone) =>
              new Intl.DateTimeFormat("es-ES", {
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
                hour12: true,
                timeZone: tz,
              }).format(new Date(d));

            const dateRange = allAppointments.length === 1
              ? fmt(firstStart, timezone)
              : `${fmt(firstStart, timezone)} – ${fmtTime(lastEnd, timezone)}`;

            // Usar el token compartido que ya se generó arriba
            const { generateCancellationLink } = await import('../utils/cancellationUtils.js');
            const cancellationLink = generateCancellationLink(sharedToken, org);

            const templateData = {
              names: customerDetails.name || "Estimado cliente",
              dateRange,
              organization: org.name,
              address: org.address || "",
              servicesList: servicesForMsg.map((s, i) => `  ${i + 1}. ${s.name} (${s.start} – ${s.end})`).join('\n'),
              employee: servicesForMsg.length === 1 
                ? servicesForMsg[0].employee 
                : "Nuestro equipo",
              cancellationLink,
            };

            const msg = await whatsappTemplates.getRenderedTemplate(
              organizationId,
              'scheduleAppointmentBatch',
              templateData
            );

            const usablePhone = hasUsablePhone(customerDetails.phone);
            if (usablePhone) {
              await waIntegrationService.sendMessage({
                orgId: organizationId,
                phone: `+${usablePhone}`,
                message: msg,
                image: null,
              });
            }
          } catch (error) {
            console.error('[createMultipleReservations] Error enviando WhatsApp:', error);
          }

          await notifyNewBooking(org, customerDetails, {
            isAuto: true,
            multi: true,
          });

          return sendResponse(
            res,
            201,
            {
              policy,
              outcome: "approved_and_appointed",
              appointments: allAppointments, // útil si quieres verlas en la respuesta
              reservations: createdReservations, // para listar en tu UI
            },
            "Citas y reservas auto-aprobadas creadas correctamente"
          );
        } catch (err) {
          // Si algo falla, guardar el error y caer al flujo MANUAL (pending)
          console.error('[auto_if_available] Error al crear citas automáticamente:', err.message);
          
          // Guardar el error para mostrarlo en el frontend
          var autoErrorMessage = err.message || 'Error al crear cita automáticamente';
        }
      }

      // === MANUAL (o AUTO que cayó) → crear reservas pendientes en transacción
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // � Generar UN groupId para todas las reservas de esta solicitud múltiple
        const reservationGroupId = new mongoose.Types.ObjectId();
        console.log(`👥 GroupId para reservas múltiples (manual): ${reservationGroupId}`);
                // Si venimos del catch de auto_if_available, autoErrorMessage estará definido
        const errorToSave = typeof autoErrorMessage !== 'undefined' ? autoErrorMessage : null;
                // 🔧 FIX: Parsear con formato explícito para interpretar como tiempo LOCAL
        let currentStart = moment.tz(startDate, 'YYYY-MM-DDTHH:mm:ss', timezone).toDate();
        const createdReservations = [];

        for (const serviceItem of services) {
          // Duración si no viene
          let duration = serviceItem.duration;
          if (!duration) {
            const serviceObj = await serviceModel
              .findById(serviceItem.serviceId)
              .session(session);
            if (!serviceObj) throw new Error("Servicio no encontrado");
            duration = serviceObj.duration;
          }

          const reservationData = {
            serviceId: serviceItem.serviceId,
            employeeId: serviceItem.employeeId || null,
            startDate: new Date(currentStart),
            customer: customer._id,
            customerDetails,
            organizationId,
            status: "pending",
            groupId: reservationGroupId, // 👥 Asignar el mismo groupId a todas
            errorMessage: errorToSave, // ⚠️ Guardar el error si vino del flujo auto
          };

          const newReservation = await reservationService.createReservation(
            reservationData,
            session
          );
          createdReservations.push(newReservation);

          currentStart.setMinutes(
            currentStart.getMinutes() + Number(duration || 0)
          );
        }

        await session.commitTransaction();
        session.endSession();

        await notifyNewBooking(org, customerDetails, {
          isAuto: false,
          multi: true,
        });

        return sendResponse(
          res,
          201,
          { policy, outcome: "pending", reservations: createdReservations },
          "Reservas múltiples creadas exitosamente"
        );
      } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw error;
      }
    } catch (error) {
      return sendResponse(
        res,
        500,
        null,
        `Error al crear reservas múltiples: ${error.message}`
      );
    }
  },

  // Obtener todas las reservas de una organización
  getReservationsByOrganization: async (req, res) => {
    const { organizationId } = req.params;
    try {
      const reservations =
        await reservationService.getReservationsByOrganization(organizationId);
      sendResponse(res, 200, reservations, "Reservas obtenidas exitosamente");
    } catch (error) {
      sendResponse(
        res,
        500,
        null,
        `Error al obtener las reservas: ${error.message}`
      );
    }
  },

  // Actualizar una reserva
  updateReservation: async (req, res) => {
    const { id } = req.params;
    try {
      const updatedReservation = await reservationService.updateReservation(
        id,
        req.body
      );
      sendResponse(
        res,
        200,
        updatedReservation,
        "Reserva actualizada exitosamente"
      );
    } catch (error) {
      sendResponse(
        res,
        500,
        null,
        `Error al actualizar la reserva: ${error.message}`
      );
    }
  },

  // Eliminar una reserva
  deleteReservation: async (req, res) => {
    const { id } = req.params;
    try {
      await reservationService.deleteReservation(id);
      sendResponse(res, 200, null, "Reserva eliminada exitosamente");
    } catch (error) {
      sendResponse(
        res,
        500,
        null,
        `Error al eliminar la reserva: ${error.message}`
      );
    }
  },
};

export default reservationController;