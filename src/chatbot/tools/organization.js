import Organization from "../../models/organizationModel.js";
import Service from "../../models/serviceModel.js";
import Employee from "../../models/employeeModel.js";

const DAY_MAP = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6 };

export default [
  {
    name: "get_setup_status",
    description:
      "Verifica el estado actual de configuración de la organización: cuántos servicios y profesionales tiene, si tiene horario configurado, etc. Úsalo al inicio para saber qué falta configurar.",
    parameters: {},
    handler: async (_params, context) => {
      const [servicesCount, employeesCount, org] = await Promise.all([
        Service.countDocuments({ organizationId: context.organizationId, isActive: true }),
        Employee.countDocuments({ organizationId: context.organizationId, isActive: true }),
        Organization.findById(context.organizationId).select("name timezone bookingConfig weeklySchedule setupCompleted"),
      ]);

      return {
        success: true,
        status: {
          organizationName: org?.name,
          servicesCount,
          employeesCount,
          hasSchedule: !!(org?.weeklySchedule?.length),
          bookingIntervalMinutes: org?.bookingConfig?.slotDuration || null,
          setupCompleted: org?.setupCompleted || false,
        },
      };
    },
  },
  {
    name: "update_booking_config",
    description:
      "Configura cómo funciona la reserva en línea: intervalo de tiempo entre citas disponibles y si requiere aprobación manual o es automática.",
    parameters: {
      slotDuration: { type: "number", description: "Intervalo en minutos entre slots disponibles (ej: 15, 30, 60). Corresponde al stepMinutes del horario semanal.", required: false },
      requiresApproval: { type: "boolean", description: "true = aprobación manual (reservationPolicy: manual), false = aprobación automática (reservationPolicy: auto_if_available)", required: false },
    },
    handler: async (params, context) => {
      const update = {};
      if (params.slotDuration !== undefined) update["weeklySchedule.stepMinutes"] = params.slotDuration;
      if (params.requiresApproval !== undefined) {
        update["reservationPolicy"] = params.requiresApproval ? "manual" : "auto_if_available";
      }

      await Organization.findByIdAndUpdate(context.organizationId, { $set: update });
      return { success: true, updated: update };
    },
  },
  {
    name: "update_schedule",
    description: `Configura el horario semanal de atención del negocio y el intervalo entre citas.
Úsalo cuando el usuario diga cosas como "atendemos lunes a viernes de 8am a 6pm" o "los sábados de 9 a 1".
Cada día debe tener: day (0=domingo..6=sábado), isOpen (true/false), start ("HH:mm"), end ("HH:mm").`,
    parameters: {
      days: {
        type: "array",
        description: "Lista de días con su configuración. Incluir todos los días 0-6.",
        required: true,
        items: { type: "object" },
      },
      stepMinutes: {
        type: "number",
        description: "Intervalo en minutos entre citas disponibles (15, 30, 60). Por defecto 30.",
        required: false,
      },
    },
    handler: async (params, context) => {
      const update = { "weeklySchedule.enabled": true, "weeklySchedule.schedule": params.days };
      if (params.stepMinutes) update["weeklySchedule.stepMinutes"] = params.stepMinutes;
      await Organization.findByIdAndUpdate(context.organizationId, { $set: update });

      const openDays = params.days.filter((d) => d.isOpen).map((d) => {
        const name = Object.keys(DAY_MAP).find((k) => DAY_MAP[k] === d.day) || d.day;
        return `${name} ${d.start}–${d.end}`;
      });
      return { success: true, openDays, stepMinutes: params.stepMinutes || 30 };
    },
  },

  {
    name: "update_primary_color",
    description: "Actualiza el color principal del branding de la organización. Acepta colores en formato hex (#1C3461) o nombres comunes que convertirás a hex.",
    parameters: {
      primaryColor: { type: "string", description: "Color en formato hex, ej: #1C3461", required: true },
    },
    handler: async (params, context) => {
      await Organization.findByIdAndUpdate(context.organizationId, {
        $set: { "branding.primaryColor": params.primaryColor },
      });
      return { success: true, primaryColor: params.primaryColor };
    },
  },

  {
    name: "mark_setup_complete",
    description: "Marca la configuración inicial como completada. Úsalo solo cuando el usuario haya creado al menos un servicio y un profesional.",
    parameters: {},
    handler: async (_params, context) => {
      const [servicesCount, employeesCount] = await Promise.all([
        Service.countDocuments({ organizationId: context.organizationId, isActive: true }),
        Employee.countDocuments({ organizationId: context.organizationId, isActive: true }),
      ]);

      if (servicesCount === 0 || employeesCount === 0) {
        return { success: false, error: "Aún faltan configurar servicios o profesionales antes de finalizar." };
      }

      await Organization.findByIdAndUpdate(context.organizationId, { setupCompleted: true });
      return { success: true, message: "Configuración inicial completada." };
    },
  },
];
