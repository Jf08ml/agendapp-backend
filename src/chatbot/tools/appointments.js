import Appointment from "../../models/appointmentModel.js";
import Client from "../../models/clientModel.js";
import Employee from "../../models/employeeModel.js";
import moment from "moment-timezone";

const CANCELLED_STATUSES = ["cancelled", "cancelled_by_customer", "cancelled_by_admin"];

const formatCurrency = (amount) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(amount || 0);

const computePending = (appt) => {
  const paid =
    (appt.advancePayment || 0) +
    (appt.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
  return Math.max(0, (appt.totalPrice || 0) - paid);
};

// Resuelve un string de fecha al rango [start, end] en UTC
const resolveDate = (dateStr, tz) => {
  const now = moment.tz(tz);

  const presets = {
    today: [now.clone().startOf("day"), now.clone().endOf("day")],
    yesterday: [now.clone().subtract(1, "day").startOf("day"), now.clone().subtract(1, "day").endOf("day")],
    this_week: [now.clone().startOf("isoWeek"), now.clone().endOf("isoWeek")],
    last_week: [now.clone().subtract(1, "week").startOf("isoWeek"), now.clone().subtract(1, "week").endOf("isoWeek")],
    this_month: [now.clone().startOf("month"), now.clone().endOf("month")],
    last_month: [now.clone().subtract(1, "month").startOf("month"), now.clone().subtract(1, "month").endOf("month")],
  };

  if (presets[dateStr]) return presets[dateStr];

  // Fecha exacta YYYY-MM-DD
  const parsed = moment.tz(dateStr, "YYYY-MM-DD", tz);
  if (parsed.isValid()) return [parsed.startOf("day"), parsed.endOf("day")];

  return null;
};

export default [
  {
    name: "query_appointments",
    description: `Consulta citas con cualquier combinación de filtros: cliente, profesional, rango de fechas, estado de pago, etc.
Úsalo para responder preguntas como:
- "¿Cuándo fue la cita de Valeria este mes y cuánto le cobré?"
- "¿Qué citas hay pendientes de cobro hoy?"
- "¿Cuántas citas atendió Carlos la semana pasada?"
- "Citas canceladas del 7 de abril"
Para dateFrom/dateTo acepta: "today", "yesterday", "this_week", "last_week", "this_month", "last_month" o una fecha "YYYY-MM-DD".
Si el usuario menciona una fecha concreta (ej: "el martes 7 de abril"), conviértela a formato YYYY-MM-DD.`,
    parameters: {
      dateFrom: { type: "string", description: "Fecha inicio. Preset o YYYY-MM-DD. Si no se especifica, usa this_month.", required: false },
      dateTo: { type: "string", description: "Fecha fin. Preset o YYYY-MM-DD. Si no se especifica, usa el mismo valor que dateFrom.", required: false },
      clientName: { type: "string", description: "Nombre parcial del cliente (opcional)", required: false },
      employeeName: { type: "string", description: "Nombre parcial del profesional (opcional)", required: false },
      status: { type: "string", description: "Estado: pending, confirmed, attended, no_show, cancelled (opcional, por defecto excluye canceladas)", required: false },
      paymentStatus: { type: "string", description: "Estado de pago: unpaid, partial, paid (opcional)", required: false },
      includeDetails: { type: "boolean", description: "Si true incluye el listado completo de citas. Por defecto muestra solo el resumen.", required: false },
    },
    handler: async (params, context) => {
      const tz = context.organization.timezone || "America/Bogota";

      // Resolver rango de fechas
      const fromStr = params.dateFrom || "this_month";
      const toStr = params.dateTo || fromStr;
      const fromRange = resolveDate(fromStr, tz);
      const toRange = resolveDate(toStr, tz);

      if (!fromRange || !toRange) {
        return { success: false, error: `No pude interpretar las fechas: "${fromStr}" / "${toStr}". Usa formato YYYY-MM-DD o presets como today, this_month.` };
      }

      const start = fromRange[0].toDate();
      const end = toRange[1].toDate();

      // Construir filtro base
      const filter = {
        organizationId: context.organizationId,
        startDate: { $gte: start, $lte: end },
      };

      // Filtro por estado
      if (params.status) {
        filter.status = params.status;
      } else {
        filter.status = { $nin: CANCELLED_STATUSES };
      }

      // Filtro por cliente (busca por nombre parcial)
      if (params.clientName) {
        const clients = await Client.find({
          organizationId: context.organizationId,
          name: { $regex: params.clientName, $options: "i" },
        }).select("_id");

        if (clients.length === 0) {
          return { success: false, error: `No se encontró ningún cliente con el nombre "${params.clientName}".` };
        }
        filter.client = { $in: clients.map((c) => c._id) };
      }

      // Filtro por profesional (busca por nombre parcial)
      if (params.employeeName) {
        const employees = await Employee.find({
          organizationId: context.organizationId,
          names: { $regex: params.employeeName, $options: "i" },
        }).select("_id");

        if (employees.length === 0) {
          return { success: false, error: `No se encontró ningún profesional con el nombre "${params.employeeName}".` };
        }
        filter.employee = { $in: employees.map((e) => e._id) };
      }

      const appointments = await Appointment.find(filter)
        .populate("client", "name phoneNumber")
        .populate("service", "name price")
        .populate("employee", "names")
        .sort({ startDate: 1 })
        .limit(100);

      // Filtro por estado de pago (post-query, computado)
      const filtered = params.paymentStatus
        ? appointments.filter((a) => a.paymentStatus === params.paymentStatus)
        : appointments;

      if (filtered.length === 0) {
        return { success: true, found: false, message: "No se encontraron citas con los filtros indicados." };
      }

      // Resumen agregado
      const totalFacturado = filtered.reduce((s, a) => s + (a.totalPrice || 0), 0);
      const totalPendiente = filtered.reduce((s, a) => s + computePending(a), 0);

      const resumen = {
        totalCitas: filtered.length,
        totalFacturado: formatCurrency(totalFacturado),
        totalCobrado: formatCurrency(totalFacturado - totalPendiente),
        totalPendiente: formatCurrency(totalPendiente),
      };

      if (!params.includeDetails) return { success: true, resumen };

      const detalle = filtered.map((appt) => ({
        fecha: moment(appt.startDate).tz(tz).format("DD/MM/YYYY hh:mm A"),
        cliente: appt.client?.name,
        servicio: appt.service?.name,
        profesional: appt.employee?.names,
        total: formatCurrency(appt.totalPrice),
        pendiente: formatCurrency(computePending(appt)),
        estadoPago: appt.paymentStatus,
        estado: appt.status,
      }));

      return { success: true, resumen, citas: detalle };
    },
  },

  {
    name: "query_revenue",
    description: `Calcula ingresos y comisiones agrupados por período, profesional o servicio.
Úsalo para preguntas como:
- "¿Cuánto facturamos este mes?"
- "¿Cuánto generó cada profesional esta semana?"
- "¿Cuál fue el servicio más vendido el mes pasado?"
Para dateFrom/dateTo acepta: "today", "yesterday", "this_week", "last_week", "this_month", "last_month" o "YYYY-MM-DD".`,
    parameters: {
      dateFrom: { type: "string", description: "Fecha inicio. Por defecto this_month.", required: false },
      dateTo: { type: "string", description: "Fecha fin. Por defecto mismo que dateFrom.", required: false },
      groupBy: { type: "string", description: "Agrupar resultados por: employee, service, day. Por defecto sin agrupación (totales).", required: false },
    },
    handler: async (params, context) => {
      const tz = context.organization.timezone || "America/Bogota";

      const fromStr = params.dateFrom || "this_month";
      const toStr = params.dateTo || fromStr;
      const fromRange = resolveDate(fromStr, tz);
      const toRange = resolveDate(toStr, tz);

      if (!fromRange || !toRange) {
        return { success: false, error: `No pude interpretar las fechas: "${fromStr}" / "${toStr}".` };
      }

      const appointments = await Appointment.find({
        organizationId: context.organizationId,
        startDate: { $gte: fromRange[0].toDate(), $lte: toRange[1].toDate() },
        status: { $nin: CANCELLED_STATUSES },
      })
        .populate("employee", "names commissionType commissionValue")
        .populate("service", "name")
        .select("employee service totalPrice advancePayment payments status startDate");

      if (appointments.length === 0) {
        return { success: true, found: false, message: "No hay citas en ese período." };
      }

      const totalFacturado = appointments.reduce((s, a) => s + (a.totalPrice || 0), 0);
      const totalPendiente = appointments.reduce((s, a) => s + computePending(a), 0);

      const base = {
        periodo: `${moment(fromRange[0]).tz(tz).format("DD/MM/YYYY")} – ${moment(toRange[1]).tz(tz).format("DD/MM/YYYY")}`,
        totalCitas: appointments.length,
        totalFacturado: formatCurrency(totalFacturado),
        totalCobrado: formatCurrency(totalFacturado - totalPendiente),
        totalPendiente: formatCurrency(totalPendiente),
      };

      if (!params.groupBy) return { success: true, ...base };

      // Agrupación por profesional
      if (params.groupBy === "employee") {
        const map = new Map();
        for (const appt of appointments) {
          const emp = appt.employee;
          if (!emp) continue;
          const key = emp._id.toString();
          if (!map.has(key)) map.set(key, { nombre: emp.names, citas: 0, total: 0, commissionType: emp.commissionType, commissionValue: emp.commissionValue });
          const e = map.get(key);
          e.citas += 1;
          e.total += appt.totalPrice || 0;
        }
        const profesionales = Array.from(map.values()).map((e) => {
          const comision = e.commissionType === "percentage" ? e.total * (e.commissionValue / 100) : e.citas * e.commissionValue;
          return { profesional: e.nombre, citas: e.citas, totalGenerado: formatCurrency(e.total), comisionEstimada: formatCurrency(comision) };
        });
        return { success: true, ...base, profesionales };
      }

      // Agrupación por servicio
      if (params.groupBy === "service") {
        const map = new Map();
        for (const appt of appointments) {
          const svc = appt.service;
          if (!svc) continue;
          const key = svc._id.toString();
          if (!map.has(key)) map.set(key, { servicio: svc.name, citas: 0, total: 0 });
          const s = map.get(key);
          s.citas += 1;
          s.total += appt.totalPrice || 0;
        }
        const servicios = Array.from(map.values())
          .sort((a, b) => b.total - a.total)
          .map((s) => ({ servicio: s.servicio, citas: s.citas, totalGenerado: formatCurrency(s.total) }));
        return { success: true, ...base, servicios };
      }

      // Agrupación por día
      if (params.groupBy === "day") {
        const map = new Map();
        for (const appt of appointments) {
          const day = moment(appt.startDate).tz(tz).format("YYYY-MM-DD");
          if (!map.has(day)) map.set(day, { fecha: day, citas: 0, total: 0 });
          const d = map.get(day);
          d.citas += 1;
          d.total += appt.totalPrice || 0;
        }
        const dias = Array.from(map.values())
          .sort((a, b) => a.fecha.localeCompare(b.fecha))
          .map((d) => ({ ...d, totalGenerado: formatCurrency(d.total) }));
        return { success: true, ...base, dias };
      }

      return { success: true, ...base };
    },
  },
];
