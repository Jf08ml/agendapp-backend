import mongoose from "mongoose";
import moment from "moment-timezone";
import Appointment from "../../models/appointmentModel.js";
import Employee from "../../models/employeeModel.js";
import Service from "../../models/serviceModel.js";
import scheduleService from "../../services/scheduleService.js";

// Resolve serviceId: accepts ObjectId or partial name
async function resolveService(value, organizationId) {
  if (!value) return null;
  if (mongoose.Types.ObjectId.isValid(value)) return Service.findById(value).lean();
  return Service.findOne({
    organizationId,
    name: { $regex: value.replace(/-/g, " "), $options: "i" },
    isActive: true,
  }).lean();
}

// Resolve employeeId: accepts ObjectId or partial name
async function resolveEmployee(value, organizationId) {
  if (!value) return null;
  if (mongoose.Types.ObjectId.isValid(value)) return Employee.findById(value).lean();
  return Employee.findOne({
    organizationId,
    names: { $regex: value.replace(/-/g, " "), $options: "i" },
    isActive: true,
  }).lean();
}

/**
 * Normalise the incoming services parameter into the enriched format that
 * findAvailableMultiServiceBlocks expects, and return the employee documents
 * needed for that call.  Works for both single-service (legacy params) and
 * multi-service (services[] array) inputs.
 */
async function buildMultiServiceInput(params, organizationId) {
  const { services, serviceId, totalDurationMinutes, employeeId } = params;

  let rawList;
  if (Array.isArray(services) && services.length > 0) {
    rawList = services; // { serviceId, employeeId, durationMinutes }
  } else if (serviceId) {
    rawList = [{ serviceId, employeeId, durationMinutes: totalDurationMinutes }];
  } else {
    return null;
  }

  const enriched = [];
  for (const svc of rawList) {
    const doc = await resolveService(svc.serviceId, organizationId);
    if (!doc) throw new Error(`Servicio no encontrado: ${svc.serviceId}`);
    const resolvedEmp = await resolveEmployee(svc.employeeId, organizationId);
    enriched.push({
      serviceId: doc._id.toString(),
      employeeId: resolvedEmp ? resolvedEmp._id.toString() : null,
      duration: svc.durationMinutes || doc.duration || 30,
      maxConcurrentAppointments: doc.maxConcurrentAppointments ?? 1,
    });
  }

  // Collect all relevant employee docs (needed by findAvailableMultiServiceBlocks)
  const employeeIds = new Set();
  for (const svc of enriched) {
    if (svc.employeeId) {
      employeeIds.add(svc.employeeId);
    } else {
      const eligible = await Employee.find({
        organizationId,
        isActive: true,
        services: svc.serviceId,
      }).lean();
      eligible.forEach((e) => employeeIds.add(e._id.toString()));
    }
  }
  const employees = await Employee.find({
    _id: { $in: Array.from(employeeIds) },
  }).lean();

  return { enriched, employees };
}

// ─── get_available_dates ─────────────────────────────────────────────────────

export const getAvailableDates = {
  name: "get_available_dates",
  description:
    "Busca fechas con disponibilidad en los próximos días. Devuelve hasta 10 fechas disponibles. Llama esto después de saber el/los servicio(s) y profesionales.",
  parameters: {
    services: {
      type: "array",
      description:
        "Usa este campo para reservas con MÚLTIPLES servicios o profesionales distintos. Array de objetos: { serviceId, employeeId (null si no aplica), durationMinutes }. El orden importa: cada servicio empieza justo cuando termina el anterior.",
      items: { type: "object" },
      required: false,
    },
    serviceId: {
      type: "string",
      description:
        "ID del servicio (solo para reservas de UN único servicio). No usar si ya se envía 'services'.",
      required: false,
    },
    totalDurationMinutes: {
      type: "number",
      description: "Duración total en minutos (solo para un único servicio).",
      required: false,
    },
    employeeId: {
      type: "string",
      description: "ID del profesional (solo para un único servicio).",
      required: false,
    },
    fromDate: {
      type: "string",
      description:
        "Fecha de inicio de búsqueda en formato YYYY-MM-DD. Calcula la fecha exacta a partir de la fecha de hoy antes de llamar esta función.",
      required: false,
    },
    fromTime: {
      type: "string",
      description:
        "Hora mínima en formato HH:mm (24h). Si se especifica, solo devuelve fechas que tengan slots disponibles A PARTIR de esa hora. Úsalo cuando el cliente mencione preferencia horaria (ej: 'después de las 4:30pm' → '16:30', 'solo en la tarde' → '13:00', 'en la mañana' → '08:00').",
      required: false,
    },
  },
  handler: async (params, { organization, organizationId }) => {
    const timezone = organization.timezone || "America/Bogota";
    const startMoment = params.fromDate
      ? moment.tz(params.fromDate, timezone)
      : moment.tz(timezone);

    const input = await buildMultiServiceInput(params, organizationId).catch(
      (e) => ({ error: e.message })
    );
    if (!input || input.error) return { error: input?.error || "Parámetros inválidos" };

    const { enriched, employees } = input;
    const allEmployeeIds = employees.map((e) => e._id);

    const rangeStart = startMoment.clone().startOf("day").toDate();
    const rangeEnd = startMoment.clone().add(45, "days").endOf("day").toDate();

    const allAppointments = await Appointment.find({
      organizationId: organization._id,
      employee: { $in: allEmployeeIds },
      startDate: { $gte: rangeStart, $lte: rangeEnd },
      status: { $nin: ["cancelled_by_customer", "cancelled_by_admin"] },
    }).lean();

    // Pre-calcular fromTime en minutos para filtro eficiente
    let fromMinutes = null;
    if (params.fromTime) {
      const [fh, fm] = params.fromTime.split(":").map(Number);
      if (!isNaN(fh) && !isNaN(fm)) fromMinutes = fh * 60 + fm;
    }

    const availableDates = [];
    let daysChecked = 0;

    while (availableDates.length < 10 && daysChecked < 45) {
      const date = startMoment.clone().add(daysChecked, "days");
      daysChecked++;
      const dateStr = date.format("YYYY-MM-DD");
      const dayStart = date.clone().startOf("day").toDate();
      const dayEnd = date.clone().endOf("day").toDate();

      const dayAppointments = allAppointments.filter((a) => {
        const s = new Date(a.startDate);
        return s >= dayStart && s <= dayEnd;
      });

      const blocks = scheduleService.findAvailableMultiServiceBlocks(
        dateStr,
        organization,
        enriched,
        employees,
        dayAppointments
      );

      if (blocks.length === 0) continue;

      if (fromMinutes !== null) {
        // Solo cuenta el día si hay al menos un slot a partir de la hora indicada
        const hasSlotAfterTime = blocks.some((b) => {
          const timePart = b.start.slice(11, 16); // "HH:mm" de "YYYY-MM-DDTHH:mm:ss"
          const [bh, bm] = timePart.split(":").map(Number);
          return bh * 60 + bm >= fromMinutes;
        });
        if (hasSlotAfterTime) availableDates.push(dateStr);
      } else {
        availableDates.push(dateStr);
      }
    }

    return { availableDates };
  },
};

// ─── get_available_slots ─────────────────────────────────────────────────────

export const getAvailableSlots = {
  name: "get_available_slots",
  description:
    "Obtiene los horarios disponibles para una fecha específica. El isoString de cada slot es el valor a usar como startDate en prepare_reservation.",
  parameters: {
    services: {
      type: "array",
      description:
        "Usa este campo para reservas con MÚLTIPLES servicios o profesionales distintos. Array de objetos: { serviceId, employeeId (null si no aplica), durationMinutes }. El orden importa.",
      items: { type: "object" },
      required: false,
    },
    serviceId: {
      type: "string",
      description: "ID del servicio (solo para un único servicio).",
      required: false,
    },
    totalDurationMinutes: {
      type: "number",
      description: "Duración total en minutos (solo para un único servicio).",
      required: false,
    },
    date: {
      type: "string",
      description: "Fecha en formato YYYY-MM-DD",
      required: true,
    },
    employeeId: {
      type: "string",
      description: "ID del profesional (solo para un único servicio).",
      required: false,
    },
  },
  handler: async (params, { organization, organizationId }) => {
    const { date } = params;
    const timezone = organization.timezone || "America/Bogota";

    const input = await buildMultiServiceInput(params, organizationId).catch(
      (e) => ({ error: e.message })
    );
    if (!input || input.error) return { error: input?.error || "Parámetros inválidos" };

    const { enriched, employees } = input;
    const allEmployeeIds = employees.map((e) => e._id);

    const dayStart = moment.tz(date, timezone).startOf("day").toDate();
    const dayEnd = moment.tz(date, timezone).endOf("day").toDate();

    const appointments = await Appointment.find({
      organizationId: organization._id,
      employee: { $in: allEmployeeIds },
      startDate: { $gte: dayStart, $lte: dayEnd },
      status: { $nin: ["cancelled_by_customer", "cancelled_by_admin"] },
    }).lean();

    const blocks = scheduleService.findAvailableMultiServiceBlocks(
      date,
      organization,
      enriched,
      employees,
      appointments
    );

    const use12h = (organization.timeFormat || "12h") !== "24h";
    const fmt = new Intl.DateTimeFormat("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: use12h,
      timeZone: timezone,
    });

    // b.start is "YYYY-MM-DDTHH:mm:ss" local time (no offset) from findAvailableMultiServiceBlocks
    let slots = blocks.map((b) => {
      const dtMoment = moment.tz(b.start, "YYYY-MM-DDTHH:mm:ss", timezone);
      return {
        time: dtMoment.format("HH:mm"),
        label: fmt.format(dtMoment.toDate()),
        isoString: b.start,
      };
    });

    // Si hay muchos slots (intervalos de 5 min), reducir a :00 y :30 para no
    // abrumar al cliente ni consumir contexto innecesario.
    if (slots.length > 12) {
      const rounded = slots.filter((s) => {
        const mins = parseInt(s.time.split(":")[1], 10);
        return mins === 0 || mins === 30;
      });
      if (rounded.length > 0) slots = rounded;
    }

    // ── Añadir info de empleado disponible por slot ──────────────────────────
    const allSpecified = enriched.every((svc) => svc.employeeId);
    const noneSpecified = enriched.every((svc) => !svc.employeeId);

    if (allSpecified) {
      // Todos los servicios tienen empleado fijo: ese empleado va en todos los slots
      const assignedNames = [
        ...new Set(
          enriched
            .map((svc) => employees.find((e) => e._id.toString() === svc.employeeId)?.names)
            .filter(Boolean)
        ),
      ];
      slots = slots.map((s) => ({ ...s, assignedEmployees: assignedNames }));
    } else if (noneSpecified && employees.length > 0) {
      // Sin preferencia de empleado: calcular qué empleados están libres en cada slot
      const empSlotSets = new Map();
      for (const emp of employees) {
        const empEnriched = enriched.map((svc) => ({
          ...svc,
          employeeId: emp._id.toString(),
        }));
        const empBlocks = scheduleService.findAvailableMultiServiceBlocks(
          date,
          organization,
          empEnriched,
          [emp],
          appointments
        );
        empSlotSets.set(emp._id.toString(), {
          names: emp.names,
          starts: new Set(empBlocks.map((b) => b.start)),
        });
      }
      slots = slots.map((s) => ({
        ...s,
        availableEmployees: employees
          .filter((emp) => empSlotSets.get(emp._id.toString())?.starts.has(s.isoString))
          .map((emp) => emp.names),
      }));
    }
    // Caso mixto (parcialmente especificado): se devuelven slots sin info de empleado

    return { date, slots };
  },
};
