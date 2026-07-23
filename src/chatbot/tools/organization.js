import Organization from "../../models/organizationModel.js";
import Service from "../../models/serviceModel.js";
import Employee from "../../models/employeeModel.js";
import { markOnboardingMilestone } from "../../utils/onboardingMilestones.js";
import { resolveBaseUrl } from "../../utils/cancellationUtils.js";

const DAY_MAP = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6 };
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// Convierte el weeklySchedule de la organización en líneas legibles ("lunes: 08:00–20:00").
const formatWeeklySchedule = (weeklySchedule) => {
  if (!weeklySchedule?.enabled || !weeklySchedule?.schedule?.length) return null;
  return weeklySchedule.schedule
    .slice()
    .sort((a, b) => a.day - b.day)
    .map((d) => (d.isOpen ? `${DAY_NAMES[d.day]}: ${d.start}–${d.end}` : `${DAY_NAMES[d.day]}: cerrado`));
};

export default [
  {
    name: "get_organization_info",
    description:
      "Obtiene la dirección, horario de atención, teléfono/WhatsApp y redes sociales del negocio. Úsala cuando el usuario pregunte por estos datos en vez de inventarlos o decir que no los tienes.",
    parameters: {},
    handler: async (_params, context) => {
      const { organization } = context;
      const hours = formatWeeklySchedule(organization.weeklySchedule);
      const { lat, lng } = organization.location || {};
      return {
        success: true,
        businessName: organization.name,
        address: organization.address || null,
        mapsUrl: lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : null,
        hours: hours || null,
        phone: organization.phoneNumber || null,
        whatsapp: organization.whatsappUrl || null,
        instagram: organization.instagramUrl || null,
        facebook: organization.facebookUrl || null,
        // Link público de reservas en línea — es EL link que el negocio comparte
        // con sus clientes para que reserven solos.
        bookingUrl: `${resolveBaseUrl(organization)}/online-reservation`,
      };
    },
  },
  {
    name: "get_setup_status",
    description:
      "Verifica el estado actual de configuración de la organización: qué servicios y profesionales ya existen (con nombres), si el horario y la política de reserva ya están configurados, y el link público de reservas. Úsalo SIEMPRE al inicio del onboarding para saber qué ya está hecho y en qué paso continuar — nunca asumas que se empieza de cero.",
    parameters: {},
    handler: async (_params, context) => {
      const [services, employees, org] = await Promise.all([
        Service.find({ organizationId: context.organizationId, isActive: true })
          .select("name")
          .limit(30)
          .lean(),
        Employee.find({ organizationId: context.organizationId, isActive: true })
          .select("names")
          .limit(30)
          .lean(),
        Organization.findById(context.organizationId).select(
          "name timezone weeklySchedule setupCompleted reservationPolicy branding domains slug"
        ),
      ]);

      // weeklySchedule es un objeto { enabled, schedule: [], stepMinutes } —
      // el horario cuenta como configurado solo si está habilitado y tiene días.
      const hasSchedule = !!(org?.weeklySchedule?.enabled && org?.weeklySchedule?.schedule?.length);
      const scheduleLines = hasSchedule ? formatWeeklySchedule(org.weeklySchedule) : null;

      return {
        success: true,
        status: {
          organizationName: org?.name,
          servicesCount: services.length,
          serviceNames: services.map((s) => s.name),
          employeesCount: employees.length,
          employeeNames: employees.map((e) => e.names),
          hasSchedule,
          schedule: scheduleLines,
          bookingIntervalMinutes: org?.weeklySchedule?.stepMinutes || null,
          // "manual" es también el valor por defecto — si el usuario aún no eligió,
          // trátalo como paso pendiente salvo que la conversación diga lo contrario.
          reservationPolicy: org?.reservationPolicy || "manual",
          primaryColor: org?.branding?.primaryColor || null,
          setupCompleted: org?.setupCompleted || false,
          bookingUrl: `${resolveBaseUrl(org)}/online-reservation`,
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
      // Marcar el hito del funnel de activación (la org se completó vía chatbot,
      // que no pasa por organizationService donde normalmente se setea).
      await markOnboardingMilestone(context.organizationId, "setupCompletedAt");
      return { success: true, message: "Configuración inicial completada." };
    },
  },
];
