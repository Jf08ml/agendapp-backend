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

      for (const appt of params.appointments) {
        const svc = await findServiceByName(organizationId, appt.serviceName);
        if (!svc) {
          return { success: false, error: `No se encontró el servicio "${appt.serviceName}". Verifica el nombre.` };
        }

        const emp = await Employee.findOne({
          organizationId,
          names: { $regex: escapeRegex(appt.employeeName), $options: "i" },
          isActive: true,
        });
        if (!emp) {
          return { success: false, error: `No se encontró el profesional "${appt.employeeName}". Verifica el nombre.` };
        }

        const startMoment = moment.tz(`${appt.date}T${appt.time}:00`, "YYYY-MM-DDTHH:mm:ss", timezone);
        if (!startMoment.isValid()) {
          return { success: false, error: `Fecha u hora inválida: "${appt.date} ${appt.time}". Usa formato YYYY-MM-DD y HH:mm.` };
        }
        const endMoment = startMoment.clone().add(svc.duration, "minutes");

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
      const { organizationId, organization } = context;
      const timezone = organization.timezone || "America/Bogota";

      if (!["cancel", "delete"].includes(params.action)) {
        return { success: false, error: 'La acción debe ser "cancel" o "delete".' };
      }

      // 1. Construir filtro base
      const filter = {
        organizationId,
        status: { $nin: CANCELLED_STATUSES },
      };

      // 2. Filtrar por cliente
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

      // 3. Filtrar por fecha
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

      // 4. Filtrar por servicio
      if (params.serviceName) {
        const svcs = await Service.find({ organizationId, name: { $regex: params.serviceName, $options: "i" }, isActive: true }).select("_id");
        if (svcs.length === 0) return { success: false, error: `No se encontró el servicio "${params.serviceName}".` };
        filter.service = { $in: svcs.map((s) => s._id) };
      }

      // 5. Filtrar por profesional
      if (params.employeeName) {
        const emps = await Employee.find({ organizationId, names: { $regex: params.employeeName, $options: "i" }, isActive: true }).select("_id");
        if (emps.length === 0) return { success: false, error: `No se encontró el profesional "${params.employeeName}".` };
        filter.employee = { $in: emps.map((e) => e._id) };
      }

      // 6. Buscar citas
      const appointments = await Appointment.find(filter)
        .populate("client", "name")
        .populate("service", "name")
        .populate("employee", "names")
        .sort({ startDate: 1 })
        .limit(10);

      if (appointments.length === 0) {
        return { success: false, error: "No se encontraron citas con esos criterios. Intenta con más detalles (cliente, fecha, servicio)." };
      }

      // 7. Si hay varias, pedir que especifique
      if (appointments.length > 1) {
        const lista = appointments.map((a) => {
          const fecha = moment(a.startDate).tz(timezone).format("DD/MM/YYYY [a las] HH:mm");
          return `• ${a.client?.name || "?"} — ${a.service?.name || "?"} con ${a.employee?.names || "?"} el ${fecha} (ID: ${a._id})`;
        });
        return {
          success: false,
          multipleFound: true,
          message: `Encontré ${appointments.length} citas. ¿A cuál te refieres?`,
          citas: lista,
        };
      }

      // 8. Exactamente una cita — ejecutar acción
      const appt = appointments[0];
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
      notes: {
        type: "string",
        description: "Nota opcional para agregar a la cita al reprogramarla.",
        required: false,
      },
    },
    handler: async (params, context) => {
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
        if (!range) return { success: false, error: `Fecha inválida: "${params.date}". Usa YYYY-MM-DD o presets.` };
        filter.startDate = { $gte: range[0].toDate(), $lte: range[1].toDate() };
      }

      if (params.serviceName) {
        const svcs = await Service.find({ organizationId, name: { $regex: params.serviceName, $options: "i" }, isActive: true }).select("_id");
        if (svcs.length === 0) return { success: false, error: `No se encontró el servicio "${params.serviceName}".` };
        filter.service = { $in: svcs.map((s) => s._id) };
      }

      if (params.employeeName) {
        const emps = await Employee.find({ organizationId, names: { $regex: params.employeeName, $options: "i" }, isActive: true }).select("_id");
        if (emps.length === 0) return { success: false, error: `No se encontró el profesional "${params.employeeName}".` };
        filter.employee = { $in: emps.map((e) => e._id) };
      }

      const appointments = await Appointment.find(filter)
        .populate("client", "name")
        .populate("service", "name")
        .populate("employee", "names")
        .sort({ startDate: 1 })
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
          message: `Encontré ${appointments.length} citas. ¿A cuál te refieres?`,
          citas: lista,
        };
      }

      const appt = appointments[0];
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

      await appointmentService.updateAppointment(appt._id.toString(), {
        startDate: newStart.format("YYYY-MM-DDTHH:mm:ss"),
        endDate: newEnd.format("YYYY-MM-DDTHH:mm:ss"),
        organizationId,
        notes: params.notes || appt.notes,
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
          const emps = await Employee.find({ organizationId, names: { $regex: escapeRegex(params.employeeName), $options: "i" }, isActive: true }).select("_id");
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
];
