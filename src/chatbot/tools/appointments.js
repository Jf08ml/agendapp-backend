import Appointment from "../../models/appointmentModel.js";
import Client from "../../models/clientModel.js";
import Employee from "../../models/employeeModel.js";
import Service from "../../models/serviceModel.js";
import appointmentService from "../../services/appointmentService.js";
import cancellationService from "../../services/cancellationService.js";
import clientService from "../../services/clientService.js";
import moment from "moment-timezone";

const CANCELLED_STATUSES = ["cancelled", "cancelled_by_customer", "cancelled_by_admin"];

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Quita acentos, pasa a minúsculas y deja solo letras/números/espacios — para comparar nombres de forma flexible
const normalizeForSearch = (str) =>
  str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Busca un servicio por nombre: primero coincidencia directa (regex), si no encuentra
// intenta coincidencia difusa por palabras (ignora acentos, paréntesis, orden de palabras, etc.)
const findServiceByName = async (organizationId, searchTerm) => {
  const direct = await Service.findOne({
    organizationId,
    name: { $regex: escapeRegex(searchTerm), $options: "i" },
    isActive: true,
  });
  if (direct) return direct;

  const services = await Service.find({ organizationId, isActive: true }).select("name duration price");
  const queryWords = normalizeForSearch(searchTerm).split(" ").filter(Boolean);
  if (queryWords.length === 0) return null;

  const matches = services.filter((s) => {
    const normName = normalizeForSearch(s.name);
    return queryWords.every((w) => normName.includes(w));
  });

  if (matches.length === 0) return null;
  // Si hay varias coincidencias, preferir la de nombre más corto (más específica)
  matches.sort((a, b) => a.name.length - b.name.length);
  return matches[0];
};

// Busca clientes por nombre: coincidencia directa primero, luego difusa por solapamiento de palabras
// (tolera nombres incompletos, acentos distintos u orden de palabras diferente). Devuelve los mejores candidatos.
const findClientsByName = async (organizationId, searchTerm) => {
  const direct = await Client.find({
    organizationId,
    name: { $regex: escapeRegex(searchTerm), $options: "i" },
  });
  if (direct.length > 0) return direct;

  const queryWords = normalizeForSearch(searchTerm).split(" ").filter(Boolean);
  if (queryWords.length === 0) return [];

  const clients = await Client.find({ organizationId });
  const scored = clients
    .map((c) => {
      const nameWords = normalizeForSearch(c.name).split(" ").filter(Boolean);
      const overlap = queryWords.filter((w) => nameWords.includes(w)).length;
      return { client: c, overlap };
    })
    .filter((s) => s.overlap >= Math.min(2, queryWords.length));

  if (scored.length === 0) return [];
  const maxOverlap = Math.max(...scored.map((s) => s.overlap));
  return scored.filter((s) => s.overlap === maxOverlap).map((s) => s.client);
};

// Busca profesionales por nombre: coincidencia directa primero, luego difusa por
// solapamiento de palabras (tolera acentos distintos —"Martínez" vs "Martinez"—
// u orden de palabras diferente). Antes de este helper, las búsquedas de
// profesional usaban un regex crudo sin normalizar tildes, por lo que un nombre
// con acento (muy común al escribir desde WhatsApp) nunca matcheaba el registro.
const findEmployeesByName = async (organizationId, searchTerm) => {
  const direct = await Employee.find({
    organizationId,
    names: { $regex: escapeRegex(searchTerm), $options: "i" },
    isActive: true,
  });
  if (direct.length > 0) return direct;

  const queryWords = normalizeForSearch(searchTerm).split(" ").filter(Boolean);
  if (queryWords.length === 0) return [];

  const employees = await Employee.find({ organizationId, isActive: true });
  const scored = employees
    .map((e) => {
      const nameWords = normalizeForSearch(e.names).split(" ").filter(Boolean);
      const overlap = queryWords.filter((w) => nameWords.includes(w)).length;
      return { employee: e, overlap };
    })
    .filter((s) => s.overlap >= Math.min(2, queryWords.length));

  if (scored.length === 0) return [];
  const maxOverlap = Math.max(...scored.map((s) => s.overlap));
  return scored.filter((s) => s.overlap === maxOverlap).map((s) => s.employee);
};

// Busca clientes por teléfono comparando los últimos 10 dígitos (ignora código de país y formato)
const findClientsByPhone = async (organizationId, phone) => {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return [];
  const last10 = digits.slice(-10);
  return Client.find({
    organizationId,
    $or: [
      { phone_e164: { $regex: `${last10}$` } },
      { phoneNumber: { $regex: `${last10}$` } },
    ],
  });
};

const PAYMENT_METHOD_MAP = {
  efectivo: "cash", cash: "cash", contado: "cash", cashea: "cash",
  tarjeta: "card", card: "card", credito: "card", debito: "card",
  transferencia: "transfer", transfer: "transfer", nequi: "transfer", daviplata: "transfer", bancolombia: "transfer", consignacion: "transfer",
};
// Convierte el método de pago dicho en lenguaje natural al enum del modelo (cash/card/transfer/other)
const normalizePaymentMethod = (method) => {
  if (!method) return "cash";
  return PAYMENT_METHOD_MAP[normalizeForSearch(method)] || "other";
};

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

// Busca citas activas por cliente/fecha/servicio/profesional — filtro compartido
// por cancel_or_delete_appointment, reschedule_appointment y update_session_notes.
// Devuelve { ok:true, appt } con la única coincidencia, o { ok:false, response }
// con el objeto exacto que el handler debe devolver (error o desambiguación).
const findMatchingAppointments = async (params, context) => {
  const { organizationId, organization } = context;
  const timezone = organization.timezone || "America/Bogota";

  const filter = {
    organizationId,
    status: { $nin: CANCELLED_STATUSES },
  };

  if (params.clientPhone || params.clientName) {
    const clients = params.clientPhone
      ? await findClientsByPhone(organizationId, params.clientPhone)
      : await findClientsByName(organizationId, params.clientName);
    if (clients.length === 0) {
      const term = params.clientPhone || params.clientName;
      return { ok: false, response: { success: false, error: `No se encontró ningún cliente con "${term}".` } };
    }
    filter.client = { $in: clients.map((c) => c._id) };
  }

  if (params.date) {
    const now = moment.tz(timezone);
    const presets = {
      today: [now.clone().startOf("day"), now.clone().endOf("day")],
      tomorrow: [now.clone().add(1, "day").startOf("day"), now.clone().add(1, "day").endOf("day")],
      this_week: [now.clone().startOf("isoWeek"), now.clone().endOf("isoWeek")],
      next_week: [now.clone().add(1, "week").startOf("isoWeek"), now.clone().add(1, "week").endOf("isoWeek")],
    };
    const range = presets[params.date] || (() => {
      const d = moment.tz(params.date, "YYYY-MM-DD", timezone);
      return d.isValid() ? [d.startOf("day"), d.clone().endOf("day")] : null;
    })();
    if (!range) {
      return {
        ok: false,
        response: { success: false, error: `Fecha inválida: "${params.date}". Usa YYYY-MM-DD o presets (today, tomorrow, this_week).` },
      };
    }
    filter.startDate = { $gte: range[0].toDate(), $lte: range[1].toDate() };
  }

  if (params.serviceName) {
    const svcs = await Service.find({ organizationId, name: { $regex: params.serviceName, $options: "i" }, isActive: true }).select("_id");
    if (svcs.length === 0) return { ok: false, response: { success: false, error: `No se encontró el servicio "${params.serviceName}".` } };
    filter.service = { $in: svcs.map((s) => s._id) };
  }

  if (params.employeeName) {
    const emps = await findEmployeesByName(organizationId, params.employeeName);
    if (emps.length === 0) return { ok: false, response: { success: false, error: `No se encontró el profesional "${params.employeeName}".` } };
    filter.employee = { $in: emps.map((e) => e._id) };
  }

  const appointments = await Appointment.find(filter)
    .populate("client", "name")
    .populate("service", "name")
    .populate("employee", "names")
    .sort({ startDate: 1 })
    .limit(10);

  if (appointments.length === 0) {
    return {
      ok: false,
      response: { success: false, error: "No se encontraron citas con esos criterios. Intenta con más detalles (cliente, fecha, servicio)." },
    };
  }

  if (appointments.length > 1) {
    const lista = appointments.map((a) => {
      const fecha = moment(a.startDate).tz(timezone).format("DD/MM/YYYY [a las] HH:mm");
      return `• ${a.client?.name || "?"} — ${a.service?.name || "?"} con ${a.employee?.names || "?"} el ${fecha} (ID: ${a._id})`;
    });
    return {
      ok: false,
      response: { success: false, multipleFound: true, message: `Encontré ${appointments.length} citas. ¿A cuál te refieres?`, citas: lista },
    };
  }

  return { ok: true, appt: appointments[0] };
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

      // Filtro por cliente (busca por nombre, con fallback difuso)
      if (params.clientName) {
        const clients = await findClientsByName(context.organizationId, params.clientName);

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
          // Si el profesional no tiene comisión configurada, decirlo explícitamente
          // en lugar de mostrar $0 (que parece un cálculo real)
          if (!e.commissionType || !e.commissionValue) {
            return { profesional: e.nombre, citas: e.citas, totalGenerado: formatCurrency(e.total), comisionEstimada: "sin comisión configurada" };
          }
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

  {
    name: "create_appointments",
    description: `Crea una o varias citas para un cliente. Si son varias, envía un único mensaje de WhatsApp con el resumen completo (servicios, profesionales y horarios).
Úsalo cuando el usuario quiera agendar citas: una sola o varias con distintos servicios, profesionales o días.
Antes de crear verifica solapamientos con citas existentes del profesional — avisa si los hay pero crea igual salvo que el usuario indique lo contrario.
Si el cliente no existe y se proporciona clientPhone, se crea automáticamente. Si no existe y solo hay clientName, pide el teléfono.`,
    parameters: {
      clientName: {
        type: "string",
        description: "Nombre del cliente (búsqueda parcial). Si el cliente no existe y se proporciona clientPhone, se usa como nombre al crearlo.",
        required: false,
      },
      clientPhone: {
        type: "string",
        description: "Teléfono del cliente con código de país (ej: +573001234567). Tiene prioridad sobre clientName. Si el cliente no existe, se crea automáticamente con este teléfono.",
        required: false,
      },
      appointments: {
        type: "array",
        description: "Lista de citas a crear. Puede incluir distintos servicios, profesionales y horarios.",
        required: true,
        items: {
          type: "object",
          properties: {
            serviceName: { type: "string", description: "Nombre del servicio (búsqueda parcial)" },
            employeeName: { type: "string", description: "Nombre del profesional (búsqueda parcial)" },
            date: { type: "string", description: "Fecha en formato YYYY-MM-DD" },
            time: { type: "string", description: "Hora en formato HH:mm en 24h. Ej: 14:30 para las 2:30 PM" },
            customPrice: { type: "number", description: "Precio personalizado. Si se omite, usa el precio del servicio." },
          },
        },
      },
      advancePayment: {
        type: "number",
        description: "Abono o anticipo del cliente (opcional, por defecto 0).",
        required: false,
      },
      consecutive: {
        type: "boolean",
        description: "Cuando el cliente recibe VARIOS servicios en una misma visita a partir de una sola hora de inicio, ponlo en true: los servicios se agendan CONSECUTIVOS (cada uno empieza cuando termina el anterior, según su duración). Pon la hora de inicio en el PRIMER servicio (las horas de los demás se ignoran). Déjalo en false (o no lo envíes) solo si el usuario indicó horas distintas para cada servicio (ej: 'a las 2 retiro y a las 4 uñas') o si son citas en días/horarios independientes.",
        required: false,
      },
    },
    handler: async (params, context) => {
      const { organizationId, organization } = context;
      const timezone = organization.timezone || "America/Bogota";

      // 1. Buscar cliente (o crear si no existe y hay teléfono)
      let clientDoc = null;
      let clientCreated = false;
      if (params.clientPhone) {
        const found = await findClientsByPhone(organizationId, params.clientPhone);
        clientDoc = found[0] || null;
      }
      if (!clientDoc && params.clientName) {
        const found = await findClientsByName(organizationId, params.clientName);
        clientDoc = found[0] || null;
      }
      if (!clientDoc) {
        if (params.clientPhone) {
          clientDoc = await clientService.createClient({
            name: params.clientName?.trim() || `Cliente ${params.clientPhone}`,
            phoneNumber: params.clientPhone,
            organizationId,
          });
          clientCreated = true;
        } else {
          return {
            success: false,
            error: `No se encontró ningún cliente con el nombre "${params.clientName}". Proporciona el teléfono (clientPhone) para crearlo automáticamente.`,
          };
        }
      }

      // 2. Resolver servicios, empleados y horarios
      const resolved = [];
      const warnings = [];
      let prevEnd = null; // fin de la cita anterior (para modo consecutivo)

      for (let i = 0; i < params.appointments.length; i++) {
        const appt = params.appointments[i];
        const svc = await findServiceByName(organizationId, appt.serviceName);
        if (!svc) {
          // No hubo match exacto ni difuso (ej. el usuario dio un nombre de categoría
          // como "pestañas hawaianas" que no aparece literal en el nombre del servicio).
          // En vez de fallar en seco, devolver el catálogo activo para que el modelo
          // (o el usuario) identifique el nombre correcto y se reintente.
          const activeServices = await Service.find({ organizationId, isActive: true })
            .select("name")
            .lean();
          return {
            success: false,
            error: `No se encontró el servicio "${appt.serviceName}".`,
            availableServices: activeServices.map((s) => s.name),
            _instruction:
              "No existe un servicio con ese nombre exacto en el catálogo. Revisa 'availableServices': si hay una coincidencia clara, reintenta create_appointments con ese nombre exacto. Si hay varias opciones razonables o ninguna coincide, pregúntale al usuario cuál de los servicios del catálogo es — nunca inventes ni asumas uno.",
          };
        }

        const emps = await findEmployeesByName(organizationId, appt.employeeName);
        if (emps.length === 0) {
          return { success: false, error: `No se encontró el profesional "${appt.employeeName}". Verifica el nombre.` };
        }
        if (emps.length > 1) {
          return {
            success: false,
            multipleFound: true,
            message: `Encontré ${emps.length} profesionales que coinciden con "${appt.employeeName}". ¿A cuál te refieres?`,
            profesionales: emps.map((e) => ({ id: e._id, name: e.names })),
          };
        }
        const emp = emps[0];

        // Modo consecutivo: a partir del 2º servicio, el inicio es el fin del anterior
        // (no la hora que mandó el modelo). El 1º usa su hora explícita.
        let startMoment;
        if (params.consecutive && i > 0 && prevEnd) {
          startMoment = prevEnd.clone();
        } else {
          startMoment = moment.tz(`${appt.date}T${appt.time}:00`, "YYYY-MM-DDTHH:mm:ss", timezone);
        }
        if (!startMoment.isValid()) {
          return { success: false, error: `Fecha u hora inválida: "${appt.date} ${appt.time}". Usa formato YYYY-MM-DD y HH:mm.` };
        }
        const endMoment = startMoment.clone().add(svc.duration, "minutes");
        prevEnd = endMoment.clone();

        // 3. Verificar solapamiento (advertencia, no bloqueo)
        const overlapping = await Appointment.find({
          employee: emp._id,
          status: { $nin: CANCELLED_STATUSES },
          startDate: { $lt: endMoment.toDate() },
          endDate: { $gt: startMoment.toDate() },
        })
          .populate("client", "name")
          .populate("service", "name");

        if (overlapping.length > 0) {
          const list = overlapping
            .map((o) => `${o.service?.name || "?"} con ${o.client?.name || "?"} a las ${moment(o.startDate).tz(timezone).format("HH:mm")}`)
            .join(", ");
          warnings.push(`⚠️ ${emp.names} ya tiene cita(s) en ese horario: ${list}`);
        }

        resolved.push({
          serviceId: svc._id.toString(),
          employeeId: emp._id.toString(),
          serviceName: svc.name,
          employeeName: emp.names,
          duration: svc.duration,
          startDateStr: startMoment.format("YYYY-MM-DDTHH:mm:ss"),
          endDateStr: endMoment.format("YYYY-MM-DDTHH:mm:ss"),
          startDate: startMoment.toDate(),
          customPrice: appt.customPrice ?? null,
        });
      }

      // 4. Filtrar citas que ya existen (mismo cliente, servicio, profesional y horario exacto)
      // Evita duplicados cuando la IA repite la creación (p.ej. tras reintentos por errores parciales)
      const duplicates = [];
      const toCreate = [];
      for (const r of resolved) {
        const existing = await Appointment.findOne({
          organizationId,
          client: clientDoc._id,
          service: r.serviceId,
          employee: r.employeeId,
          startDate: r.startDate,
          status: { $nin: CANCELLED_STATUSES },
        });
        if (existing) {
          duplicates.push(r);
        } else {
          toCreate.push(r);
        }
      }

      if (toCreate.length === 0) {
        const lista = duplicates
          .map((r) => `• ${r.serviceName} con ${r.employeeName} el ${moment(r.startDate).tz(timezone).format("DD/MM/YYYY [a las] HH:mm")}`)
          .join("\n");
        return {
          success: true,
          cliente: clientDoc.name,
          citasCreadas: 0,
          yaExistian: true,
          mensaje: `Esa(s) cita(s) ya existían para ${clientDoc.name}, no se creó ninguna nueva:\n${lista}`,
        };
      }

      // 5. Crear citas — siempre vía createMultiEmployeeBatch (incluso si es una sola)
      // para que todas queden con groupId, status "confirmed" y un único mensaje de WhatsApp
      const blocks = toCreate.map((r) => ({
        services: [r.serviceId],
        employee: r.employeeId,
        startDate: r.startDateStr,
        customDurations: { [r.serviceId]: r.duration },
        ...(r.customPrice != null && { customPrices: { [r.serviceId]: r.customPrice } }),
      }));

      await appointmentService.createMultiEmployeeBatch({
        client: clientDoc._id.toString(),
        organizationId,
        advancePayment: params.advancePayment || 0,
        employeeRequestedByClient: false,
        blocks,
        skipConcurrencyCheck: true,
      });

      // 6. Respuesta
      const resumen = toCreate
        .map((r) => {
          const hora = moment(r.startDate).tz(timezone).format("DD/MM/YYYY [a las] HH:mm");
          return `• ${r.serviceName} con ${r.employeeName} el ${hora}`;
        })
        .join("\n");

      return {
        success: true,
        cliente: clientDoc.name,
        citasCreadas: toCreate.length,
        resumen,
        whatsappConfirmacionEnviada: "intentado — depende de si la plantilla está aprobada o hay canal disponible",
        ...(clientCreated && { clienteCreado: true }),
        ...(warnings.length > 0 && { advertencias: warnings }),
        ...(duplicates.length > 0 && {
          omitidasPorDuplicado: duplicates.map((r) => `${r.serviceName} con ${r.employeeName} (ya existía a esa hora)`),
        }),
      };
    },
  },

  {
    name: "cancel_or_delete_appointment",
    description: `Cancela o elimina definitivamente una cita existente.
- "cancel": cambia el estado a cancelada (queda en el historial). Opcionalmente notifica al cliente por WhatsApp.
- "delete": borra la cita permanentemente del sistema (sin historial).
Busca la cita por criterios (cliente, fecha, servicio, profesional). Si encuentra más de una, devuelve la lista para que el usuario especifique. Si encuentra exactamente una, ejecuta la acción.
Úsalo cuando el usuario diga "cancela", "borra", "elimina" o "quita" una cita.`,
    parameters: {
      action: {
        type: "string",
        description: '"cancel" para cancelar (mantiene historial) o "delete" para eliminar definitivamente.',
        required: true,
      },
      clientName: {
        type: "string",
        description: "Nombre parcial del cliente cuya cita se quiere cancelar/eliminar.",
        required: false,
      },
      clientPhone: {
        type: "string",
        description: "Teléfono del cliente (con código de país). Prioridad sobre clientName.",
        required: false,
      },
      date: {
        type: "string",
        description: 'Fecha de la cita en formato YYYY-MM-DD o preset (today, tomorrow, this_week). Ej: "mañana" → YYYY-MM-DD del día siguiente.',
        required: false,
      },
      serviceName: {
        type: "string",
        description: "Nombre parcial del servicio para afinar la búsqueda (opcional).",
        required: false,
      },
      employeeName: {
        type: "string",
        description: "Nombre parcial del profesional para afinar la búsqueda (opcional).",
        required: false,
      },
      notifyClient: {
        type: "boolean",
        description: 'Solo aplica si action="cancel". true = enviar WhatsApp al cliente informando la cancelación. Por defecto false.',
        required: false,
      },
    },
    handler: async (params, context) => {
      const { organization } = context;
      const timezone = organization.timezone || "America/Bogota";

      if (!["cancel", "delete"].includes(params.action)) {
        return { success: false, error: 'La acción debe ser "cancel" o "delete".' };
      }

      const found = await findMatchingAppointments(params, context);
      if (!found.ok) return found.response;

      // Exactamente una cita — ejecutar acción
      const appt = found.appt;
      const fecha = moment(appt.startDate).tz(timezone).format("DD/MM/YYYY [a las] HH:mm");
      const resumen = `${appt.service?.name || "?"} de ${appt.client?.name || "?"} con ${appt.employee?.names || "?"} el ${fecha}`;

      if (params.action === "cancel") {
        const result = await cancellationService.cancelAppointment(
          appt._id.toString(),
          "admin",
          null,
          params.notifyClient ?? false
        );
        if (!result.success) {
          return { success: false, error: result.message };
        }
        return {
          success: true,
          action: "cancel",
          resumen,
          whatsappEnviado: result.waEnviado ?? false,
          ...(params.notifyClient && !result.waEnviado && {
            advertenciaWa: "La cancelación se realizó pero no se pudo enviar el WhatsApp al cliente (template no aprobado o sin canal disponible).",
          }),
        };
      }

      // delete
      await appointmentService.deleteAppointment(appt._id.toString());
      return {
        success: true,
        action: "delete",
        resumen,
      };
    },
  },

  {
    name: "reschedule_appointment",
    description: `Reprograma una cita existente a una nueva fecha y hora.
Úsalo cuando el usuario diga "reprograma", "cambia la fecha", "mueve la cita" de un cliente.
Busca la cita por cliente, fecha actual, servicio o profesional. Si encuentra más de una, devuelve la lista para que el usuario especifique.
Si hay solapamiento en el nuevo horario, lo avisa pero reprograma igual.`,
    parameters: {
      clientName: {
        type: "string",
        description: "Nombre parcial del cliente cuya cita se quiere reprogramar.",
        required: false,
      },
      clientPhone: {
        type: "string",
        description: "Teléfono del cliente (con código de país). Prioridad sobre clientName.",
        required: false,
      },
      date: {
        type: "string",
        description: "Fecha actual de la cita (YYYY-MM-DD o preset today/tomorrow/this_week) para identificarla. Opcional pero ayuda a afinar.",
        required: false,
      },
      serviceName: {
        type: "string",
        description: "Nombre parcial del servicio para afinar la búsqueda (opcional).",
        required: false,
      },
      employeeName: {
        type: "string",
        description: "Nombre parcial del profesional para afinar la búsqueda (opcional).",
        required: false,
      },
      newDate: {
        type: "string",
        description: "Nueva fecha en formato YYYY-MM-DD.",
        required: true,
      },
      newTime: {
        type: "string",
        description: "Nueva hora en formato HH:mm (24h). Ej: 14:30 para las 2:30 PM.",
        required: true,
      },
    },
    handler: async (params, context) => {
      const { organizationId, organization } = context;
      const timezone = organization.timezone || "America/Bogota";

      const found = await findMatchingAppointments(params, context);
      if (!found.ok) return found.response;

      const appt = found.appt;
      const newStart = moment.tz(`${params.newDate}T${params.newTime}:00`, "YYYY-MM-DDTHH:mm:ss", timezone);
      if (!newStart.isValid()) {
        return { success: false, error: `Fecha u hora inválida: "${params.newDate} ${params.newTime}". Usa YYYY-MM-DD y HH:mm.` };
      }

      const duracionMs = new Date(appt.endDate).getTime() - new Date(appt.startDate).getTime();
      const newEnd = moment(new Date(newStart.toDate().getTime() + Math.max(duracionMs, 0))).tz(timezone);

      const overlapping = await Appointment.find({
        _id: { $ne: appt._id },
        employee: appt.employee?._id,
        status: { $nin: CANCELLED_STATUSES },
        startDate: { $lt: newEnd.toDate() },
        endDate: { $gt: newStart.toDate() },
      })
        .populate("client", "name")
        .populate("service", "name");

      const warnings = overlapping.map((o) =>
        `${o.service?.name || "?"} con ${o.client?.name || "?"} a las ${moment(o.startDate).tz(timezone).format("HH:mm")}`
      );

      const fechaAnterior = moment(appt.startDate).tz(timezone).format("DD/MM/YYYY [a las] HH:mm");
      const fechaNueva = newStart.format("DD/MM/YYYY [a las] HH:mm");

      // Para dejar constancia de lo ocurrido en la sesión usa update_session_notes,
      // no este tool — reprogramar y anotar son operaciones distintas.
      await appointmentService.updateAppointment(appt._id.toString(), {
        startDate: newStart.format("YYYY-MM-DDTHH:mm:ss"),
        endDate: newEnd.format("YYYY-MM-DDTHH:mm:ss"),
        organizationId,
      });

      return {
        success: true,
        resumen: `${appt.service?.name || "?"} de ${appt.client?.name || "?"} con ${appt.employee?.names || "?"}`,
        de: fechaAnterior,
        a: fechaNueva,
        ...(warnings.length > 0 && {
          advertencia: `${appt.employee?.names || "El profesional"} ya tiene cita(s) en ese horario: ${warnings.join(", ")}`,
        }),
      };
    },
  },

  {
    name: "update_session_notes",
    description: `Registra o actualiza la nota de sesión de una cita YA EXISTENTE (lo que se hizo, observaciones, seguimiento para la próxima vez).
Busca la cita por cliente, fecha, servicio o profesional — igual que cancel_or_delete_appointment. Si encuentra más de una, devuelve la lista para que el usuario especifique.
Úsala cuando el usuario quiera "dejar una nota", "registrar cómo fue la sesión", "anotar" algo sobre una cita puntual. NO uses reschedule_appointment para esto — esa tool es solo para cambiar fecha/hora.`,
    parameters: {
      clientName: {
        type: "string",
        description: "Nombre parcial del cliente cuya cita se quiere anotar.",
        required: false,
      },
      clientPhone: {
        type: "string",
        description: "Teléfono del cliente (con código de país). Prioridad sobre clientName.",
        required: false,
      },
      date: {
        type: "string",
        description: 'Fecha de la cita en formato YYYY-MM-DD o preset (today, tomorrow, this_week). Opcional pero ayuda a afinar.',
        required: false,
      },
      serviceName: {
        type: "string",
        description: "Nombre parcial del servicio para afinar la búsqueda (opcional).",
        required: false,
      },
      employeeName: {
        type: "string",
        description: "Nombre parcial del profesional para afinar la búsqueda (opcional).",
        required: false,
      },
      sessionNotes: {
        type: "string",
        description: "Texto de la nota a guardar. Reemplaza la nota anterior de esa cita si ya tenía una.",
        required: true,
      },
    },
    handler: async (params, context) => {
      const found = await findMatchingAppointments(params, context);
      if (!found.ok) return found.response;

      const appt = found.appt;
      await appointmentService.updateSessionNotes(appt._id.toString(), params.sessionNotes);

      return {
        success: true,
        resumen: `${appt.service?.name || "?"} de ${appt.client?.name || "?"} con ${appt.employee?.names || "?"}`,
      };
    },
  },

  {
    name: "get_client_notes",
    description: `Consulta las notas de sesión YA GUARDADAS en las citas de un cliente, o de TODOS los clientes de la organización, para responder preguntas o hacer un resumen sobre ellas.
Úsala cuando el usuario pida LEER, CONSULTAR o RESUMIR notas de sesión existentes (ej: "recoge todas las notas de Rafael", "resúmeme las notas de este mes", "qué dice la nota de la cita del 13", "algún cliente con seguimiento pendiente según las notas"). NO uses update_session_notes para esto — esa tool solo ESCRIBE una nota nueva, no lee las existentes.
Si no se especifica cliente, busca en TODOS los clientes de la organización dentro del rango de fechas (usa this_month por defecto si el usuario no da fechas, para no traer el historial completo del negocio de una sola vez).`,
    parameters: {
      clientName: {
        type: "string",
        description: "Nombre parcial del cliente cuyas notas se quieren consultar. Si se omite junto con clientPhone, busca en todos los clientes.",
        required: false,
      },
      clientPhone: {
        type: "string",
        description: "Teléfono del cliente. Prioridad sobre clientName.",
        required: false,
      },
      dateFrom: { type: "string", description: 'Fecha inicio de las citas a revisar. Preset ("today", "this_month", etc.) o YYYY-MM-DD. Si se omite y no hay cliente específico, usa this_month.', required: false },
      dateTo: { type: "string", description: "Fecha fin. Preset o YYYY-MM-DD. Si se omite, usa el mismo valor que dateFrom.", required: false },
    },
    handler: async (params, context) => {
      const { organizationId, organization } = context;
      const tz = organization.timezone || "America/Bogota";

      const filter = { organizationId, sessionNotes: { $ne: "" } };

      if (params.clientPhone) {
        const clients = await findClientsByPhone(organizationId, params.clientPhone);
        if (clients.length === 0) {
          return { success: false, error: `No se encontró ningún cliente con el teléfono "${params.clientPhone}".` };
        }
        filter.client = { $in: clients.map((c) => c._id) };
      } else if (params.clientName) {
        const clients = await findClientsByName(organizationId, params.clientName);
        if (clients.length === 0) {
          return { success: false, error: `No se encontró ningún cliente con el nombre "${params.clientName}".` };
        }
        filter.client = { $in: clients.map((c) => c._id) };
      }

      const hasClientFilter = !!filter.client;
      // Sin cliente específico: exigir rango de fechas (this_month por defecto) para
      // no traer de una sola vez el historial completo de notas de la organización.
      const fromStr = params.dateFrom || (hasClientFilter ? null : "this_month");
      if (fromStr) {
        const toStr = params.dateTo || fromStr;
        const fromRange = resolveDate(fromStr, tz);
        const toRange = resolveDate(toStr, tz);
        if (!fromRange || !toRange) {
          return { success: false, error: `No pude interpretar las fechas: "${fromStr}" / "${toStr}". Usa formato YYYY-MM-DD o presets como today, this_month.` };
        }
        filter.startDate = { $gte: fromRange[0].toDate(), $lte: toRange[1].toDate() };
      }

      const appointments = await Appointment.find(filter)
        .populate("client", "name")
        .populate("service", "name")
        .populate("employee", "names")
        .sort({ startDate: -1 })
        .limit(hasClientFilter ? 50 : 30);

      if (appointments.length === 0) {
        return { success: true, found: false, message: "No se encontraron notas de sesión con esos filtros." };
      }

      const notas = appointments.map((a) => ({
        fecha: moment(a.startDate).tz(tz).format("DD/MM/YYYY"),
        cliente: a.client?.name || "?",
        servicio: a.service?.name || "?",
        profesional: a.employee?.names || "?",
        nota: a.sessionNotes,
      }));

      return { success: true, totalNotas: notas.length, notas };
    },
  },

  {
    name: "register_payment",
    description: `Registra un pago (completo o un abono/parcial) sobre una cita existente.
Busca la cita por cliente, fecha, servicio o profesional — igual que cancel_or_delete_appointment. Si encuentra más de una, devuelve la lista para que el usuario especifique (puedes repetir la llamada con appointmentId).
Úsalo cuando el usuario diga "registra un pago", "abonó", "pagó", "le cobré", "ya canceló la cita" (en sentido de pago), etc.`,
    parameters: {
      clientName: {
        type: "string",
        description: "Nombre parcial del cliente/paciente de la cita.",
        required: false,
      },
      clientPhone: {
        type: "string",
        description: "Teléfono del cliente (con código de país). Prioridad sobre clientName.",
        required: false,
      },
      date: {
        type: "string",
        description: 'Fecha de la cita en formato YYYY-MM-DD o preset (today, tomorrow, this_week, next_week). Opcional, ayuda a afinar la búsqueda.',
        required: false,
      },
      serviceName: {
        type: "string",
        description: "Nombre parcial del servicio para afinar la búsqueda (opcional).",
        required: false,
      },
      employeeName: {
        type: "string",
        description: "Nombre parcial del profesional para afinar la búsqueda (opcional).",
        required: false,
      },
      appointmentId: {
        type: "string",
        description: "ID de la cita si ya se conoce (de una consulta previa o de un resultado con multipleFound). Si se da, se omite la búsqueda por los demás criterios.",
        required: false,
      },
      amount: {
        type: "number",
        description: "Monto del pago a registrar.",
        required: true,
      },
      method: {
        type: "string",
        description: 'Método de pago: "efectivo", "tarjeta" o "transferencia". Por defecto efectivo.',
        required: false,
      },
      note: {
        type: "string",
        description: "Nota opcional sobre el pago.",
        required: false,
      },
    },
    handler: async (params, context) => {
      const { organizationId, organization } = context;
      const timezone = organization.timezone || "America/Bogota";

      if (!params.amount || params.amount <= 0) {
        return { success: false, error: "El monto del pago debe ser mayor a 0." };
      }

      let appt;

      if (params.appointmentId) {
        appt = await Appointment.findOne({ _id: params.appointmentId, organizationId })
          .populate("client", "name")
          .populate("service", "name")
          .populate("employee", "names");
        if (!appt) return { success: false, error: "No se encontró ninguna cita con ese ID." };
      } else {
        const filter = {
          organizationId,
          status: { $nin: CANCELLED_STATUSES },
        };

        if (params.clientPhone || params.clientName) {
          const clients = params.clientPhone
            ? await findClientsByPhone(organizationId, params.clientPhone)
            : await findClientsByName(organizationId, params.clientName);
          if (clients.length === 0) {
            const term = params.clientPhone || params.clientName;
            return { success: false, error: `No se encontró ningún cliente con "${term}".` };
          }
          filter.client = { $in: clients.map((c) => c._id) };
        }

        if (params.date) {
          const now = moment.tz(timezone);
          const presets = {
            today: [now.clone().startOf("day"), now.clone().endOf("day")],
            tomorrow: [now.clone().add(1, "day").startOf("day"), now.clone().add(1, "day").endOf("day")],
            this_week: [now.clone().startOf("isoWeek"), now.clone().endOf("isoWeek")],
            next_week: [now.clone().add(1, "week").startOf("isoWeek"), now.clone().add(1, "week").endOf("isoWeek")],
          };
          const range = presets[params.date] || (() => {
            const d = moment.tz(params.date, "YYYY-MM-DD", timezone);
            return d.isValid() ? [d.startOf("day"), d.clone().endOf("day")] : null;
          })();
          if (!range) {
            return { success: false, error: `Fecha inválida: "${params.date}". Usa YYYY-MM-DD o presets (today, tomorrow, this_week).` };
          }
          filter.startDate = { $gte: range[0].toDate(), $lte: range[1].toDate() };
        }

        if (params.serviceName) {
          const svc = await findServiceByName(organizationId, params.serviceName);
          if (!svc) return { success: false, error: `No se encontró el servicio "${params.serviceName}".` };
          filter.service = svc._id;
        }

        if (params.employeeName) {
          const emps = await findEmployeesByName(organizationId, params.employeeName);
          if (emps.length === 0) return { success: false, error: `No se encontró el profesional "${params.employeeName}".` };
          filter.employee = { $in: emps.map((e) => e._id) };
        }

        const appointments = await Appointment.find(filter)
          .populate("client", "name")
          .populate("service", "name")
          .populate("employee", "names")
          .sort({ startDate: -1 })
          .limit(10);

        if (appointments.length === 0) {
          return { success: false, error: "No se encontraron citas con esos criterios. Intenta con más detalles (cliente, fecha, servicio o profesional)." };
        }

        if (appointments.length > 1) {
          const lista = appointments.map((a) => {
            const fecha = moment(a.startDate).tz(timezone).format("DD/MM/YYYY [a las] HH:mm");
            return `• ${a.client?.name || "?"} — ${a.service?.name || "?"} con ${a.employee?.names || "?"} el ${fecha} (ID: ${a._id})`;
          });
          return {
            success: false,
            multipleFound: true,
            message: `Encontré ${appointments.length} citas. ¿A cuál le registro el pago? (vuelve a llamar con appointmentId)`,
            citas: lista,
          };
        }

        appt = appointments[0];
      }

      const pendienteAntes = computePending(appt);
      const metodo = normalizePaymentMethod(params.method);
      const updated = await appointmentService.addPaymentToAppointment(appt._id.toString(), {
        amount: params.amount,
        method: metodo,
        note: params.note || "",
      });

      const fecha = moment(appt.startDate).tz(timezone).format("DD/MM/YYYY [a las] HH:mm");
      const pendienteDespues = computePending(updated);

      return {
        success: true,
        resumen: `${appt.service?.name || "?"} de ${appt.client?.name || "?"} con ${appt.employee?.names || "?"} el ${fecha}`,
        montoRegistrado: formatCurrency(params.amount),
        metodo,
        totalCita: formatCurrency(updated.totalPrice),
        pendienteAntes: formatCurrency(pendienteAntes),
        pendienteAhora: formatCurrency(pendienteDespues),
        estadoPago: updated.paymentStatus,
        ...(pendienteDespues === 0 && { mensaje: "¡Cita pagada en su totalidad!" }),
      };
    },
  },

  {
    name: "mark_appointment_attendance",
    description: `Marca si un cliente asistió o no asistió a una cita.
Busca la cita por cliente, fecha, servicio o profesional — igual que register_payment. Si encuentra más de una, devuelve la lista para que el usuario especifique.
Úsalo cuando el usuario diga "asistió", "no vino", "no se presentó", "faltó a la cita", etc.`,
    parameters: {
      clientName: { type: "string", description: "Nombre parcial del cliente de la cita.", required: false },
      clientPhone: { type: "string", description: "Teléfono del cliente (con código de país). Prioridad sobre clientName.", required: false },
      date: { type: "string", description: 'Fecha de la cita en formato YYYY-MM-DD o preset (today, tomorrow, this_week). Opcional, ayuda a afinar.', required: false },
      serviceName: { type: "string", description: "Nombre parcial del servicio para afinar la búsqueda (opcional).", required: false },
      employeeName: { type: "string", description: "Nombre parcial del profesional para afinar la búsqueda (opcional).", required: false },
      appointmentId: { type: "string", description: "ID de la cita si ya se conoce. Si se da, se omite la búsqueda por los demás criterios.", required: false },
      status: { type: "string", description: '"attended" si asistió, "no_show" si no asistió.', required: true },
      notifyClient: { type: "boolean", description: "Si true, envía un WhatsApp automático al cliente (solo aplica para no_show, según la plantilla configurada). Por defecto false.", required: false },
    },
    handler: async (params, context) => {
      const { organizationId, organization } = context;
      const timezone = organization.timezone || "America/Bogota";

      if (!["attended", "no_show"].includes(params.status)) {
        return { success: false, error: 'El estado debe ser "attended" o "no_show".' };
      }

      let appt;

      if (params.appointmentId) {
        appt = await Appointment.findOne({ _id: params.appointmentId, organizationId })
          .populate("client", "name")
          .populate("service", "name")
          .populate("employee", "names");
        if (!appt) return { success: false, error: "No se encontró ninguna cita con ese ID." };
      } else {
        const filter = { organizationId, status: { $nin: CANCELLED_STATUSES } };

        if (params.clientPhone || params.clientName) {
          const clients = params.clientPhone
            ? await findClientsByPhone(organizationId, params.clientPhone)
            : await findClientsByName(organizationId, params.clientName);
          if (clients.length === 0) {
            const term = params.clientPhone || params.clientName;
            return { success: false, error: `No se encontró ningún cliente con "${term}".` };
          }
          filter.client = { $in: clients.map((c) => c._id) };
        }

        if (params.date) {
          const now = moment.tz(timezone);
          const presets = {
            today: [now.clone().startOf("day"), now.clone().endOf("day")],
            tomorrow: [now.clone().add(1, "day").startOf("day"), now.clone().add(1, "day").endOf("day")],
            this_week: [now.clone().startOf("isoWeek"), now.clone().endOf("isoWeek")],
          };
          const range = presets[params.date] || (() => {
            const d = moment.tz(params.date, "YYYY-MM-DD", timezone);
            return d.isValid() ? [d.startOf("day"), d.clone().endOf("day")] : null;
          })();
          if (!range) return { success: false, error: `Fecha inválida: "${params.date}".` };
          filter.startDate = { $gte: range[0].toDate(), $lte: range[1].toDate() };
        }

        if (params.serviceName) {
          const svc = await findServiceByName(organizationId, params.serviceName);
          if (!svc) return { success: false, error: `No se encontró el servicio "${params.serviceName}".` };
          filter.service = svc._id;
        }

        if (params.employeeName) {
          const emps = await findEmployeesByName(organizationId, params.employeeName);
          if (emps.length === 0) return { success: false, error: `No se encontró el profesional "${params.employeeName}".` };
          filter.employee = { $in: emps.map((e) => e._id) };
        }

        const appointments = await Appointment.find(filter)
          .populate("client", "name")
          .populate("service", "name")
          .populate("employee", "names")
          .sort({ startDate: -1 })
          .limit(10);

        if (appointments.length === 0) {
          return { success: false, error: "No se encontraron citas con esos criterios. Intenta con más detalles." };
        }
        if (appointments.length > 1) {
          const lista = appointments.map((a) => {
            const fecha = moment(a.startDate).tz(timezone).format("DD/MM/YYYY [a las] HH:mm");
            return `• ${a.client?.name || "?"} — ${a.service?.name || "?"} con ${a.employee?.names || "?"} el ${fecha} (ID: ${a._id})`;
          });
          return {
            success: false,
            multipleFound: true,
            message: `Encontré ${appointments.length} citas. ¿A cuál te refieres? (vuelve a llamar con appointmentId)`,
            citas: lista,
          };
        }
        appt = appointments[0];
      }

      try {
        await appointmentService.markAttendance(appt._id.toString(), params.status, organizationId, params.notifyClient ?? false);
      } catch (err) {
        return { success: false, error: err.message };
      }

      const fecha = moment(appt.startDate).tz(timezone).format("DD/MM/YYYY [a las] HH:mm");
      return {
        success: true,
        resumen: `${appt.service?.name || "?"} de ${appt.client?.name || "?"} con ${appt.employee?.names || "?"} el ${fecha}`,
        estado: params.status === "attended" ? "Asistió" : "No asistió",
      };
    },
  },
];
