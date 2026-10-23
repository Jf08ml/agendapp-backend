import appointmentService from "../services/appointmentService.js";
import appointmentSeriesService from "../services/appointmentSeriesService.js";
import cancellationService from "../services/cancellationService.js";
import packageService from "../services/packageService.js";
import organizationService from "../services/organizationService.js";
import subscriptionService from "../services/subscriptionService.js";
import sendResponse from "../utils/sendResponse.js";
import { auditLogService } from "../services/auditLogService.js";

const appointmentController = {
  // Controlador para crear una nueva cita
  createAppointment: async (req, res) => {
    try {
      const newAppointment = await appointmentService.createAppointment(
        req.body
      );

      const organization = await organizationService.getOrganizationById(
        newAppointment.organizationId
      );

      const notify = {
        title: "Cita creada",
        message: "Se te ha asignado una nueva cita",
        icon: organization.branding.pwaIcon,
      };
      await subscriptionService.sendNotificationToUser(
        newAppointment.userId,
        JSON.stringify(notify)
      );
      sendResponse(res, 201, newAppointment, "Cita creada exitosamente");
    } catch (error) {
      sendResponse(res, error.statusCode || 500, null, error.message);
    }
  },

  // Controlador para crear múltiples citas (batch)
  createMultiEmployeeBatch: async (req, res) => {
    try {
      const createdAppointments = await appointmentService.createMultiEmployeeBatch(req.body);
      sendResponse(res, 201, createdAppointments, "Citas multi-profesional creadas exitosamente");
    } catch (error) {
      if (error.code === 'CONCURRENCY_LIMIT_REACHED') {
        return sendResponse(res, 409, {
          code: 'CONCURRENCY_LIMIT_REACHED',
          conflictingAppointments: error.conflictingAppointments || [],
        }, error.message);
      }
      sendResponse(res, 500, null, error.message);
    }
  },

  createAppointmentsBatch: async (req, res) => {
    try {
      const createdAppointments =
        await appointmentService.createAppointmentsBatch(req.body);

      // Notificación webpush (una o varias, según tu UX)
      // Por ejemplo, notificar al empleado:
      if (createdAppointments.length > 0) {
        const org = await organizationService.getOrganizationById(
          createdAppointments[0].organizationId
        );

        const notify = {
          title: "Citas creadas",
          message: `Se te asignaron ${createdAppointments.length} citas`,
          icon: org.branding?.pwaIcon,
        };

        // Usa el campo correcto (employee puede ser id u objeto; ajústalo)
        await subscriptionService.sendNotificationToUser(
          createdAppointments[0].employee,
          JSON.stringify(notify)
        );
      }

      sendResponse(
        res,
        201,
        createdAppointments,
        "Citas creadas exitosamente (batch)"
      );
    } catch (error) {
      if (error.code === 'CONCURRENCY_LIMIT_REACHED') {
        return sendResponse(res, 409, {
          code: 'CONCURRENCY_LIMIT_REACHED',
          conflictingAppointments: error.conflictingAppointments || [],
        }, error.message);
      }
      sendResponse(res, error.statusCode || 500, null, error.message);
    }
  },

  // Controlador para obtener todas las citas
  getAppointments: async (req, res) => {
    try {
      const appointments = await appointmentService.getAppointments();
      sendResponse(res, 200, appointments, "Citas obtenidas exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para obtener citas de una organización con rango de fechas opcional
  getAppointmentsByOrganizationWithDates: async (req, res) => {
    const { organizationId } = req.params;
    const { startDate, endDate, employeeIds } = req.query; // Fechas y empleados como query params

    try {
      // Parsear employeeIds si viene como string (ej: "id1,id2,id3")
      let parsedEmployeeIds = null;
      if (employeeIds) {
        parsedEmployeeIds = Array.isArray(employeeIds) 
          ? employeeIds 
          : employeeIds.split(',').filter(id => id.trim());
      }

      const appointments =
        await appointmentService.getAppointmentsByOrganizationWithDates(
          organizationId,
          startDate,
          endDate,
          parsedEmployeeIds
        );

      // 🔢 "Sesión N de M" para las citas cubiertas por paquete
      const sessionLabels = await packageService.getPackageSessionLabels(appointments);
      const withLabels = sessionLabels.size === 0
        ? appointments
        : appointments.map((a) => {
            const label = sessionLabels.get(String(a._id));
            return label ? { ...a.toJSON(), packageSession: label } : a;
          });

      sendResponse(
        res,
        200,
        withLabels,
        "Citas de la organización obtenidas exitosamente"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

    // Controlador para obtener agregados de citas (buckets) timezone-aware
    getAppointmentsAggregated: async (req, res) => {
      const { organizationId } = req.params;
      const { startDate, endDate, granularity, employeeIds } = req.query;

      try {
        let parsedEmployeeIds = null;
        if (employeeIds) {
          parsedEmployeeIds = Array.isArray(employeeIds)
            ? employeeIds
            : employeeIds.split(',').filter(id => id.trim());
        }

        const buckets = await appointmentService.getAppointmentsAggregatedByRange(
          organizationId,
          startDate,
          endDate,
          granularity || 'day',
          parsedEmployeeIds
        );

        sendResponse(res, 200, buckets, 'Buckets de citas obtenidos exitosamente');
      } catch (error) {
        sendResponse(res, 500, null, error.message);
      }
    },

  // Controlador para obtener una cita por ID
  getAppointmentById: async (req, res) => {
    const { id } = req.params;
    try {
      const appointment = await appointmentService.getAppointmentById(id);
      sendResponse(res, 200, appointment, "Cita encontrada");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para obtener las citas de un empleado
  getAppointmentsByEmployee: async (req, res) => {
    const { employeeId } = req.params;
    try {
      const appointments = await appointmentService.getAppointmentsByEmployee(
        employeeId
      );
      sendResponse(
        res,
        200,
        appointments,
        "Citas del empleado obtenidas exitosamente"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para obtener citas por cliente
  getAppointmentsByClient: async (req, res) => {
    const { clientId } = req.params;
    const { status } = req.query; // Filtro opcional por estado (puede ser "pending,confirmed" o "cancelled_by_admin")
    try {
      const appointments = await appointmentService.getAppointmentsByClient(
        clientId,
        status
      );
      sendResponse(
        res,
        200,
        appointments,
        "Citas del cliente obtenidas exitosamente"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // 📝 Actualizar solo las notas de la sesión (registro genérico de lo hecho en la cita)
  updateSessionNotes: async (req, res) => {
    const { id } = req.params;
    const { sessionNotes } = req.body;
    try {
      const updatedAppointment = await appointmentService.updateSessionNotes(id, sessionNotes);
      sendResponse(res, 200, updatedAppointment, "Notas de la sesión guardadas exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para actualizar una cita
  updateAppointment: async (req, res) => {
    const { id } = req.params;
    try {
      const updatedAppointment = await appointmentService.updateAppointment(
        id,
        req.body
      );

      const organization = await organizationService.getOrganizationById(
        updatedAppointment.organizationId
      );

      const notify = {
        title: "Cita actualizada",
        message: "Se ha actualizado una cita",
        icon: organization.branding.pwaIcon,
      };

      await subscriptionService.sendNotificationToUser(
        updatedAppointment.employee,
        JSON.stringify(notify)
      );
      sendResponse(
        res,
        200,
        updatedAppointment,
        "Cita actualizada exitosamente"
      );
    } catch (error) {
      if (error.code === 'CONCURRENCY_LIMIT_REACHED') {
        return sendResponse(res, 409, {
          code: 'CONCURRENCY_LIMIT_REACHED',
          conflictingAppointments: error.conflictingAppointments || [],
        }, error.message);
      }
      sendResponse(res, error.statusCode || 404, null, error.message);
    }
  },

  // 🔁 Reprogramar una cita de serie junto con las siguientes ("esta y las siguientes").
  // previewOnly → solo devuelve cómo quedarían (con choques); force → mueve también
  // las que chocan o caen fuera de horario (si no, esas se quedan donde estaban).
  rescheduleSeriesFromAppointment: async (req, res) => {
    const { id } = req.params;
    const { previewOnly, force, ...changes } = req.body;
    try {
      const organizationId = req.organization?._id || changes.organizationId;
      // El plan se calcula ANTES de actualizar la cita editada (mide contra su horario original)
      const plan = await appointmentSeriesService.planSeriesReschedule(id, changes, organizationId);

      if (previewOnly === true) {
        return sendResponse(res, 200, { items: plan.items, summary: plan.summary }, "Vista previa de la reprogramación");
      }

      const updatedAppointment = await appointmentService.updateAppointment(id, changes);
      const result = await appointmentSeriesService.applySeriesReschedulePlan(plan, { force: force === true });

      try {
        const organization = await organizationService.getOrganizationById(organizationId);
        await subscriptionService.sendNotificationToUser(
          updatedAppointment.employee,
          JSON.stringify({
            title: "Citas reprogramadas",
            message: `Se reprogramaron ${result.moved.length + 1} citas de una serie`,
            icon: organization?.branding?.pwaIcon || "",
          })
        );
      } catch (notifError) {
        console.error("Error enviando notificación de reprogramación:", notifError);
      }

      sendResponse(
        res,
        200,
        { appointment: updatedAppointment, moved: result.moved, skipped: result.skipped },
        `Se reprogramaron ${result.moved.length + 1} citas`
      );
    } catch (error) {
      if (error.code === 'CONCURRENCY_LIMIT_REACHED') {
        return sendResponse(res, 409, {
          code: 'CONCURRENCY_LIMIT_REACHED',
          conflictingAppointments: error.conflictingAppointments || [],
        }, error.message);
      }
      sendResponse(res, error.statusCode || 400, null, error.message);
    }
  },

  // Controlador para cancelar una cita (cambia estado a cancelled_by_admin, mantiene historial)
  cancelAppointment: async (req, res) => {
    const { id } = req.params;
    const { notifyClient } = req.body;
    try {
      const appointmentData = await appointmentService.getAppointmentById(id);

      // Usar cancellationService para cambiar el estado
      const result = await cancellationService.cancelAppointment(id, 'admin', null, notifyClient);

      if (!result.success) {
        return sendResponse(res, 400, null, result.message);
      }

      const organization = await organizationService.getOrganizationById(
        appointmentData.organizationId
      );

      const notify = {
        title: "Cita cancelada",
        message: "Se ha cancelado una cita",
        icon: organization.branding.pwaIcon,
      };

      await subscriptionService.sendNotificationToUser(
        appointmentData.employee,
        JSON.stringify(notify)
      );
      sendResponse(res, 200, result.data, "Cita cancelada exitosamente");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para eliminar una cita definitivamente (sin historial)
  deleteAppointment: async (req, res) => {
    const { id } = req.params;
    try {
      const appointmentData = await appointmentService.getAppointmentById(id);
      const result = await appointmentService.deleteAppointment(id);

      const organization = await organizationService.getOrganizationById(
        appointmentData.organizationId
      );

      // 📋 Audit log
      await auditLogService.log({
        organizationId: appointmentData.organizationId,
        action: "delete_appointment",
        entityType: "appointment",
        entityId: id,
        entitySnapshot: auditLogService.snapshotAppointment(appointmentData),
        performedById: req.user?._id || req.user?.id || null,
        performedByName: req.user?.name || req.user?.email || "Admin",
        performedByRole: req.user?.role || null,
      });

      const notify = {
        title: "Cita eliminada",
        message: "Se ha eliminado una cita",
        icon: organization.branding.pwaIcon,
      };

      await subscriptionService.sendNotificationToUser(
        appointmentData.employee,
        JSON.stringify(notify)
      );
      sendResponse(res, 200, null, result.message);
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // 🔁 Controlador para crear/previsualizar series de citas recurrentes
  createAppointmentSeries: async (req, res) => {
    try {
      // Extraer todos los campos del body
      const {
        employee,
        client,
        services,
        startDate,
        endDate,
        organizationId,
        advancePayment,
        employeeRequestedByClient,
        customPrices,
        additionalItemsByService,
        usePackageForServices, // 📦 { serviceId: clientPackageId }
        recurrencePattern,
        previewOnly,
        notifyAllAppointments // 📨 Nueva opción para controlar tipo de notificación
      } = req.body;

      // Validar recurrencePattern
      if (!recurrencePattern || typeof recurrencePattern !== 'object' || recurrencePattern.type === 'none') {
        return sendResponse(res, 400, null, "recurrencePattern válido es requerido");
      }

      // Construir baseAppointment
      const baseAppointment = {
        employee,
        client,
        services,
        startDate,
        endDate,
        organizationId,
        advancePayment: advancePayment || 0,
        employeeRequestedByClient: employeeRequestedByClient || false,
        customPrices,
        additionalItemsByService,
        usePackageForServices
      };

      const options = { 
        previewOnly: previewOnly === true,
        allowOverbooking: false,
        omitIfNoWork: true,
        omitIfConflict: true,
        skipNotification: false,
        notifyAllAppointments: notifyAllAppointments ?? true // 📨 Por defecto notificar todas
      };

      console.log('📥 Payload recibido:', { 
        baseAppointment, 
        recurrencePattern, 
        options,
        servicesCount: services?.length 
      });

      // Si solo se solicita preview, no crear las citas
      if (options.previewOnly) {
        const preview = await appointmentSeriesService.previewSeriesAppointments(
          baseAppointment,
          recurrencePattern,
          options
        );

        return sendResponse(
          res,
          200,
          {
            totalOccurrences: preview.summary.total,
            availableCount: preview.summary.available,
            packageCovered: preview.summary.packageCovered,
            packageCharged: preview.summary.packageCharged,
            occurrences: preview.occurrences.map(occ => ({
              startDate: occ.date,
              endDate: occ.endDate,
              status: occ.status,
              reason: occ.reason,
              package: occ.package
            }))
          },
          "Preview de serie generado exitosamente"
        );
      }

      // Crear la serie completa de citas
      const result = await appointmentSeriesService.createSeriesAppointments(
        baseAppointment,
        recurrencePattern,
        options
      );

      // Enviar notificación al empleado (opcional)
      if (result.created.length > 0 && !options.skipNotification) {
        try {
          const org = await organizationService.getOrganizationById(
            baseAppointment.organizationId
          );

          const notify = {
            title: "Serie de citas creada",
            message: `Se te asignaron ${result.created.length} citas recurrentes`,
            icon: org.branding?.pwaIcon || "",
          };

          await subscriptionService.sendNotificationToUser(
            baseAppointment.employee,
            JSON.stringify(notify)
          );
        } catch (notifError) {
          console.error('Error enviando notificación:', notifError);
          // No fallar la request por error de notificación
        }
      }

      sendResponse(
        res,
        201,
        {
          seriesId: result.seriesId,
          totalOccurrences: result.created.length,
          createdCount: result.created.length,
          availableCount: result.created.length,
          created: result.created,
          skipped: result.skipped
        },
        `Serie creada exitosamente: ${result.created.length} citas`
      );

    } catch (error) {
      console.error('Error en createAppointmentSeries:', error);
      sendResponse(res, 500, null, error.message);
    }
  },

  // Confirmar múltiples citas en batch
  batchConfirmAppointments: async (req, res) => {
    try {
      const { appointmentIds, organizationId } = req.body;

      if (!organizationId) {
        return sendResponse(res, 400, null, "organizationId es requerido");
      }

      if (!Array.isArray(appointmentIds) || appointmentIds.length === 0) {
        return sendResponse(
          res,
          400,
          null,
          "Se requiere un array de IDs de citas"
        );
      }

      const results = await appointmentService.batchConfirmAppointments(
        appointmentIds,
        organizationId
      );

      // Enviar notificación al empleado si hay citas confirmadas
      if (results.confirmed.length > 0) {
        try {
          const org = await organizationService.getOrganizationById(
            organizationId
          );

          // Agrupar por empleado si tienes esa info
          // Por ahora una notificación genérica
          const notify = {
            title: "Citas confirmadas",
            message: `Se confirmaron ${results.confirmed.length} citas`,
            icon: org.branding?.pwaIcon || "",
          };

          // Esto asume que todas las citas son del mismo empleado
          // Si necesitas notificar a múltiples empleados, necesitarás ajustarlo
          // Para simplificar, omitimos la notificación o la envías al admin
          
          console.log("Citas confirmadas exitosamente:", notify);
        } catch (notifError) {
          console.error("Error enviando notificación:", notifError);
        }
      }

      const message = `Confirmadas: ${results.confirmed.length}, Ya confirmadas: ${results.alreadyConfirmed.length}, Fallidas: ${results.failed.length}`;

      sendResponse(res, 200, results, message);
    } catch (error) {
      console.error("Error en batchConfirmAppointments:", error);
      sendResponse(res, 500, null, error.message);
    }
  },
  // Marcar asistencia de una cita (attended / no_show)
  markAttendance: async (req, res) => {
    try {
      const { appointmentId } = req.params;
      const { status, notifyClient } = req.body;
      const organizationId = req.organization?._id || req.user?.organizationId;
      if (!organizationId) {
        return sendResponse(res, 400, null, "No se pudo determinar la organización.");
      }

      const appointment = await appointmentService.markAttendance(
        appointmentId,
        status,
        organizationId,
        notifyClient
      );

      sendResponse(res, 200, appointment, "Asistencia registrada correctamente.");
    } catch (error) {
      console.error("Error en markAttendance:", error);
      const statusCode = error.statusCode || 500;
      sendResponse(res, statusCode, null, error.message);
    }
  },

  // 💰 Registrar un pago para una cita
  addPayment: async (req, res) => {
    try {
      const { id } = req.params;
      const { amount, method, date, note } = req.body;
      if (!amount || amount <= 0) {
        return sendResponse(res, 400, null, 'El monto del pago debe ser mayor a 0');
      }
      const registeredBy = req.user?._id || req.user?.id || undefined;
      const appointment = await appointmentService.addPaymentToAppointment(id, { amount, method, date, note, registeredBy });
      sendResponse(res, 200, appointment, 'Pago registrado correctamente');
    } catch (error) {
      console.error('Error en addPayment:', error);
      sendResponse(res, error.statusCode || 500, null, error.message);
    }
  },

  // 💰 Eliminar un pago de una cita
  removePayment: async (req, res) => {
    try {
      const { id, paymentId } = req.params;
      const appointment = await appointmentService.removePaymentFromAppointment(id, paymentId);
      sendResponse(res, 200, appointment, 'Pago eliminado correctamente');
    } catch (error) {
      console.error('Error en removePayment:', error);
      sendResponse(res, error.statusCode || 500, null, error.message);
    }
  },
};

export default appointmentController;
