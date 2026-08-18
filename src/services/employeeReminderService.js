import moment from "moment-timezone";
import Appointment from "../models/appointmentModel.js";
import Employee from "../models/employeeModel.js";
import organizationService from "./organizationService.js";
import notificationService from "./notificationService.js";
import subscriptionService from "./subscriptionService.js";

const REMINDER_PRESETS = [1, 2, 6, 24];

/**
 * Resuelve la preferencia efectiva de recordatorio de un empleado, sin
 * depender de los defaults de Mongoose (documentos antiguos guardados antes
 * de este campo no lo traen en memoria salvo que Mongoose los hidrate).
 */
const resolveEmployeeReminderPreference = (employee) => {
  const prefs = employee?.reminderPreferences;
  const hoursBefore = REMINDER_PRESETS.includes(prefs?.hoursBefore)
    ? prefs.hoursBefore
    : 1;
  return {
    enabled: prefs?.enabled !== false,
    hoursBefore,
  };
};

// Usa el tiempo real restante (no la etiqueta del preset): una cita creada
// 20 min antes de empezar cae en la ventana del preset "1h" en el próximo
// tick, y anunciarla como "en 1 hora" sería falso.
const formatRelativeTime = (startDate, timezone) => {
  const now = moment.tz(timezone);
  const start = moment.tz(startDate, timezone);
  const minutes = Math.max(0, Math.round(start.diff(now, "minutes")));

  if (minutes < 90) {
    return `en ${minutes} minuto${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `en ${hours} hora${hours === 1 ? "" : "s"}`;
  }
  return start.format("DD/MM/YYYY [a las] hh:mm A");
};

const employeeReminderService = {
  resolveEmployeeReminderPreference,

  /**
   * Recorre las organizaciones activas y notifica (in-app + push) al
   * profesional asignado de cada cita que cae dentro de su propia ventana
   * de anticipación configurada (1/2/6/24h). Independiente del recordatorio
   * al cliente (que va por WhatsApp y vive en appointmentService.js).
   */
  sendEmployeeReminders: async () => {
    try {
      const organizations = await organizationService.getOrganizations();
      const activeOrgs = organizations.filter(
        (org) => org.hasAccessBlocked !== true
      );

      let totalSent = 0;

      for (const org of activeOrgs) {
        const orgId = org._id.toString();
        const timezone = org.timezone || "America/Bogota";

        const employees = await Employee.find({
          organizationId: orgId,
          isActive: { $ne: false },
        });
        if (!employees.length) continue;

        // Agrupar empleados por su hoursBefore efectivo, para hacer una sola
        // consulta de citas por cada valor de preset realmente en uso.
        const bucketsByHours = new Map();
        for (const employee of employees) {
          const { enabled, hoursBefore } =
            resolveEmployeeReminderPreference(employee);
          if (!enabled) continue;
          if (!bucketsByHours.has(hoursBefore)) {
            bucketsByHours.set(hoursBefore, []);
          }
          bucketsByHours.get(hoursBefore).push(employee._id);
        }
        if (!bucketsByHours.size) continue;

        for (const [hoursBefore, employeeIds] of bucketsByHours) {
          const now = new Date();
          const windowEnd = moment
            .tz(timezone)
            .add(hoursBefore, "hours")
            .endOf("hour")
            .toDate();

          const candidates = await Appointment.find({
            organizationId: orgId,
            employee: { $in: employeeIds },
            startDate: { $gte: now, $lt: windowEnd },
            employeeReminderSent: { $ne: true },
            status: {
              $nin: ["cancelled", "cancelled_by_customer", "cancelled_by_admin"],
            },
          })
            .populate("client")
            .populate("service")
            .populate("employee");

          if (!candidates.length) continue;

          // Marcar antes de notificar (con el mismo filtro $ne:true) para que
          // dos ticks solapados nunca notifiquen la misma cita dos veces.
          const candidateIds = candidates.map((c) => c._id);
          const markResult = await Appointment.updateMany(
            { _id: { $in: candidateIds }, employeeReminderSent: { $ne: true } },
            { $set: { employeeReminderSent: true, employeeReminderSentAt: new Date() } }
          );
          if (!markResult.modifiedCount) continue;

          for (const appt of candidates) {
            if (!appt.employee) continue;
            try {
              const clientName = appt.client?.name || "un cliente";
              const serviceName = appt.service?.name || "un servicio";
              const relativeTime = formatRelativeTime(appt.startDate, timezone);
              const title = "⏰ Recordatorio de cita";
              const message = `Tienes una cita con ${clientName} (${serviceName}) ${relativeTime}`;

              await Promise.allSettled([
                notificationService.createNotification({
                  title,
                  message,
                  organizationId: orgId,
                  employeeId: appt.employee._id,
                  type: "reminder",
                  status: "unread",
                  frontendRoute: "/manage-agenda",
                }),
                subscriptionService.sendNotificationToUser(
                  appt.employee._id,
                  JSON.stringify({ title, message, icon: org.branding?.pwaIcon })
                ),
              ]);
              totalSent += 1;
            } catch (err) {
              console.error(
                `[employeeReminderService] Error notificando cita ${appt._id}:`,
                err?.message || err
              );
            }
          }
        }
      }

      if (totalSent > 0) {
        console.log(
          `[employeeReminderService] ${totalSent} recordatorio(s) de empleado enviado(s)`
        );
      }
    } catch (error) {
      console.error(
        "[employeeReminderService] Error en sendEmployeeReminders:",
        error?.message || error
      );
    }
  },
};

export default employeeReminderService;
