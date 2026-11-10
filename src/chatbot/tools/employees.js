import Employee from "../../models/employeeModel.js";
import Service from "../../models/serviceModel.js";
import employeeService from "../../services/employeeService.js";
import bcrypt from "bcryptjs";
import moment from "moment-timezone";
import scheduleService from "../../services/scheduleService.js";
import { findEmployeesByName, findServiceByName } from "./appointments.js";

const generateTempPassword = () => Math.random().toString(36).slice(-8) + "A1!";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNBLOCK_REASON_PATTERN = /desbloq|quitar|liberar|disponible|s[ií] trabaja|elimina/i;
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
// "2026-11-07" → "sábado 7 de noviembre" (calculado en UTC sobre la fecha calendario)
const dayLabel = (dateStr) => {
  const d = moment.utc(dateStr, "YYYY-MM-DD");
  return `${DAY_NAMES[d.day()]} ${d.date()} de ${MONTH_NAMES[d.month()]}`;
};

// Profesional por nombre (o todos los activos). Devuelve { employees } o { error: <resultado de tool> }.
const resolveTargetEmployees = async (params, organizationId) => {
  if (params.allEmployees) {
    return { employees: await Employee.find({ organizationId, isActive: true }) };
  }
  if (!params.employeeName) {
    return { error: { success: false, error: "Indica el profesional o usa allEmployees: true." } };
  }
  const employees = await findEmployeesByName(organizationId, params.employeeName);
  if (employees.length === 0) {
    return { error: { success: false, error: `No encontré un profesional activo llamado "${params.employeeName}".` } };
  }
  if (employees.length > 1) {
    return {
      error: {
        success: false,
        multipleFound: true,
        candidates: employees.map((e) => e.names),
        _instruction: "Pregunta al usuario a cuál de estos profesionales se refiere y vuelve a llamar con el nombre completo.",
      },
    };
  }
  return { employees };
};

export default [
  {
    name: "create_employee",
    description:
      "Crea un nuevo profesional/empleado en la organización. Úsalo cuando el usuario quiera registrar a un trabajador (peluquero, médico, instructor, etc.). El email es OPCIONAL: si el usuario no lo tiene a mano, créalo sin email (el profesional simplemente no tendrá acceso propio a la plataforma hasta que se le asigne uno). NO insistas pidiendo el email si el usuario no lo da.",
    parameters: {
      names: { type: "string", description: "Nombre completo del profesional", required: true },
      position: { type: "string", description: "Cargo o especialidad (ej: Peluquero, Médico, Instructor)", required: true },
      email: { type: "string", description: "Correo electrónico del profesional (será su usuario de acceso). OPCIONAL — omítelo si el usuario no lo tiene; el profesional podrá trabajar igual y se le asigna correo después.", required: false },
      phoneNumber: { type: "string", description: "Número de teléfono (con código de país, ej: +573001234567)", required: true },
      commissionType: { type: "string", description: "Tipo de comisión: 'percentage' (porcentaje del valor de la cita) o 'fixed' (monto fijo por cita). Por defecto 'percentage'.", required: false },
      commissionValue: { type: "number", description: "Valor de la comisión. Si es porcentaje, ingresa el número (ej: 40 para 40%). Si es fijo, el monto exacto por cita. Por defecto 0.", required: false },
    },
    handler: async (params, context) => {
      const tempPassword = generateTempPassword();
      const hashed = await bcrypt.hash(tempPassword, 10);

      // Sin email: placeholder único no-login (el modelo lo exige). El profesional
      // aparece en la agenda y recibe citas, pero no puede iniciar sesión hasta
      // que el admin le asigne un correo real desde Gestionar Profesionales.
      const hasRealEmail = !!params.email?.trim();
      const email = hasRealEmail
        ? params.email.toLowerCase().trim()
        : `profesional-${Date.now().toString(36)}@sin-acceso.agenditapp.com`;

      const employee = await Employee.create({
        names: params.names,
        position: params.position,
        email,
        phoneNumber: params.phoneNumber,
        password: hashed,
        commissionType: params.commissionType || "percentage",
        commissionValue: params.commissionValue ?? 0,
        organizationId: context.organizationId,
      });

      return {
        success: true,
        employee: { id: employee._id, names: employee.names, position: employee.position, email: hasRealEmail ? employee.email : null },
        ...(hasRealEmail
          ? {
              tempPassword,
              note: `Contraseña temporal generada: ${tempPassword} — compártela con el profesional para que pueda iniciar sesión y cambiarla.`,
            }
          : {
              note: "Profesional creado sin correo: ya puede recibir citas en la agenda, pero no tendrá acceso propio a la plataforma. Cuando quieras darle acceso, asígnale un correo desde Gestionar Profesionales.",
            }),
      };
    },
  },
  {
    name: "get_employees",
    description: "Obtiene la lista de profesionales/empleados de la organización.",
    parameters: {},
    handler: async (_params, context) => {
      const employees = await Employee.find({ organizationId: context.organizationId, isActive: true }).select("names position email");
      return { success: true, employees: employees.map((e) => ({ id: e._id, names: e.names, position: e.position, email: e.email })) };
    },
  },
  {
    name: "assign_services_to_employee",
    description: "Asigna servicios a un profesional. El profesional solo podrá atender los servicios asignados.",
    parameters: {
      employeeId: { type: "string", description: "ID o nombre del profesional", required: true },
      serviceNames: { type: "array", description: "Lista de nombres de servicios a asignar", required: true, items: { type: "string" } },
    },
    handler: async (params, context) => {
      // Acepta tanto ObjectId como nombre parcial del profesional
      let employee = null;
      if (/^[a-f\d]{24}$/i.test(params.employeeId)) {
        employee = await Employee.findOne({ _id: params.employeeId, organizationId: context.organizationId, isActive: true });
      }
      if (!employee) {
        // Tolera tildes y orden de palabras ("Jesus Blazquez" vs "Jesús Blázquez")
        const found = await findEmployeesByName(context.organizationId, params.employeeId);
        if (found.length > 1) {
          return {
            success: false,
            error: `Hay ${found.length} profesionales que coinciden con "${params.employeeId}".`,
            profesionales: found.map((e) => ({ id: e._id, name: e.names })),
          };
        }
        employee = found[0] || null;
      }
      if (!employee) {
        return { success: false, error: `No se encontró el profesional "${params.employeeId}". Verifica el nombre.` };
      }

      // Cada nombre se resuelve por separado: primero igualdad exacta (sin
      // mayúsculas/tildes — "Soft gel" no debe caer en "Retoque soft gel"), luego
      // coincidencia difusa. Antes era un $in exacto y sensible a mayúsculas que
      // ignoraba en silencio los nombres sin match y respondía success: true.
      const catalog = await Service.find({ organizationId: context.organizationId, isActive: true }).select("_id name");
      const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
      const matched = new Map();
      const notFound = [];
      for (const name of params.serviceNames || []) {
        const svc =
          catalog.find((s) => norm(s.name) === norm(name)) ||
          (await findServiceByName(context.organizationId, name));
        if (svc) matched.set(String(svc._id), svc);
        else notFound.push(name);
      }

      if (matched.size === 0) {
        return {
          success: false,
          error: `No se encontró ninguno de los servicios indicados: ${notFound.join(", ")}.`,
          availableServices: catalog.map((s) => s.name),
        };
      }

      await Employee.findByIdAndUpdate(employee._id, {
        $addToSet: { services: { $each: [...matched.values()].map((s) => s._id) } },
      });

      return {
        success: true,
        employee: employee.names,
        assigned: [...matched.values()].map((s) => s.name),
        ...(notFound.length > 0 && {
          notFound,
          availableServices: catalog.map((s) => s.name),
          _instruction:
            "Algunos servicios NO se asignaron porque no existen con ese nombre (ver notFound). Díselo al usuario; no digas que se asignaron todos.",
        }),
      };
    },
  },
  {
    name: "update_employee",
    description:
      "Edita los datos de un profesional existente: nombre, cargo, teléfono, comisión, o si está activo/inactivo. NO permite cambiar el correo (es su usuario de acceso — eso se hace desde Gestionar Profesionales). Solo actualiza los campos indicados.",
    parameters: {
      employeeId: { type: "string", description: "ID o nombre (parcial) del profesional a editar.", required: true },
      names: { type: "string", description: "Nuevo nombre completo (opcional).", required: false },
      position: { type: "string", description: "Nuevo cargo/especialidad (opcional).", required: false },
      phoneNumber: { type: "string", description: "Nuevo teléfono (opcional).", required: false },
      commissionType: { type: "string", description: "Nuevo tipo de comisión: 'percentage' o 'fixed' (opcional).", required: false },
      commissionValue: { type: "number", description: "Nuevo valor de comisión (opcional).", required: false },
      isActive: { type: "boolean", description: "true para activar, false para desactivar al profesional. Opcional.", required: false },
    },
    handler: async (params, context) => {
      let employee = null;
      if (/^[a-f\d]{24}$/i.test(params.employeeId)) {
        employee = await Employee.findOne({ _id: params.employeeId, organizationId: context.organizationId });
      }
      if (!employee) {
        employee = await Employee.findOne({
          organizationId: context.organizationId,
          names: { $regex: params.employeeId, $options: "i" },
        });
      }
      if (!employee) {
        return { success: false, error: `No se encontró el profesional "${params.employeeId}". Verifica el nombre.` };
      }

      const update = {};
      for (const key of ["names", "position", "phoneNumber", "commissionType", "commissionValue", "isActive"]) {
        if (params[key] !== undefined) update[key] = params[key];
      }
      if (Object.keys(update).length === 0) {
        return { success: false, error: "No se indicó ningún campo para actualizar." };
      }

      const updated = await employeeService.updateEmployee(employee._id.toString(), update);

      return {
        success: true,
        employee: {
          id: updated._id,
          names: updated.names,
          position: updated.position,
          phoneNumber: updated.phoneNumber,
          isActive: updated.isActive,
        },
        actualizados: Object.keys(update),
      };
    },
  },
  {
    name: "block_employee_time",
    description:
      "Bloquea la agenda de un profesional (o de todos) en una fecha/rango y franja horaria — ej: 'ponle agenda ocupada a Leidy el viernes de 10 a 12', 'bloquea a todos el 24 de diciembre'. Crea el mismo bloqueo que el botón de bloquear agenda de Gestionar agenda: ese tiempo deja de ofrecerse en la reserva en línea. NUNCA simules un bloqueo creando una cita falsa.",
    parameters: {
      employeeName: { type: "string", description: "Nombre del profesional. Omítelo si allEmployees es true.", required: false },
      allEmployees: { type: "boolean", description: "true para bloquear a todos los profesionales activos.", required: false },
      startDate: { type: "string", description: "Fecha de inicio YYYY-MM-DD", required: true },
      endDate: { type: "string", description: "Fecha de fin YYYY-MM-DD (igual a startDate si es un solo día)", required: false },
      startTime: { type: "string", description: "Hora de inicio HH:mm (24h). Omítela junto con endTime para bloquear el día completo.", required: false },
      endTime: { type: "string", description: "Hora de fin HH:mm (24h)", required: false },
      reason: { type: "string", description: "Motivo (opcional, ej: 'Cita médica')", required: false },
    },
    handler: async (params, context) => {
      const { organizationId } = context;
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      const timeRegex = /^([01]?\d|2[0-3]):[0-5]\d$/;
      const startDate = params.startDate;
      const endDate = params.endDate || params.startDate;
      if (!dateRegex.test(startDate || "") || !dateRegex.test(endDate)) {
        return { success: false, error: "Las fechas deben tener formato YYYY-MM-DD." };
      }
      if (startDate > endDate) {
        return { success: false, error: "La fecha de inicio debe ser anterior o igual a la de fin." };
      }
      const allDay = !params.startTime && !params.endTime;
      if (!allDay) {
        if (!timeRegex.test(params.startTime || "") || !timeRegex.test(params.endTime || "")) {
          return { success: false, error: "Indica hora de inicio y de fin en formato HH:mm (24h)." };
        }
        const toMin = (t) => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]);
        if (toMin(params.startTime) >= toMin(params.endTime)) {
          return { success: false, error: "La hora de inicio debe ser anterior a la hora de fin." };
        }
      }

      // Caso real (Diana Vargas, 2026-11-09): sin tool para quitar bloqueos, el modelo
      // "desbloqueó" llamando esta tool con reason "Desbloqueo" — agregó dos bloqueos
      // más y le dijo a la dueña que ya estaba disponible.
      if (UNBLOCK_REASON_PATTERN.test(params.reason || "")) {
        return {
          success: false,
          error: "Esta herramienta solo AGREGA bloqueos. Para quitar un bloqueo usa unblock_employee_time.",
        };
      }

      const target = await resolveTargetEmployees(params, organizationId);
      if (target.error) return target.error;
      const { employees } = target;

      const exception = {
        startDate,
        endDate,
        allDay,
        ...(allDay ? {} : { startTime: params.startTime, endTime: params.endTime }),
        ...(params.reason ? { reason: params.reason } : {}),
        createdAt: new Date(),
      };
      for (const emp of employees) {
        emp.scheduleExceptions.push(exception);
        await emp.save();
      }

      return {
        success: true,
        blocked: employees.map((e) => e.names),
        startDate,
        endDate,
        // Con día de la semana calculado aquí: el modelo dijo "jueves 7 de noviembre" (era sábado)
        fechas: startDate === endDate ? dayLabel(startDate) : `del ${dayLabel(startDate)} al ${dayLabel(endDate)}`,
        franja: allDay ? "día completo" : `${params.startTime}–${params.endTime}`,
        note: "El bloqueo impide nuevas reservas en línea en ese tiempo. Las citas que ya existían en esa franja NO se cancelan; se quitan desde Gestionar agenda.",
        _instruction: "Al confirmar, usa el texto de 'fechas' tal cual (trae el día de la semana correcto).",
      };
    },
  },

  {
    name: "get_employee_blocks",
    description:
      "Lista los bloqueos de agenda (días o franjas en rojo) de un profesional o de todos en un rango de fechas. Úsala cuando pregunten qué días/horas están bloqueados, cuando digan que un bloqueo 'no se refleja', y antes de afirmar que algo está o no está bloqueado.",
    parameters: {
      employeeName: { type: "string", description: "Nombre del profesional. Omítelo para ver los de todos.", required: false },
      startDate: { type: "string", description: "Desde (YYYY-MM-DD). Por defecto hoy.", required: false },
      endDate: { type: "string", description: "Hasta (YYYY-MM-DD). Por defecto 60 días después.", required: false },
    },
    handler: async (params, context) => {
      const { organizationId, organization } = context;
      const today = moment().tz(organization?.timezone || "America/Bogota").format("YYYY-MM-DD");
      const from = DATE_RE.test(params.startDate || "") ? params.startDate : today;
      const to = DATE_RE.test(params.endDate || "")
        ? params.endDate
        : moment.utc(from, "YYYY-MM-DD").add(60, "days").format("YYYY-MM-DD");

      const target = await resolveTargetEmployees({ ...params, allEmployees: !params.employeeName }, organizationId);
      if (target.error) return target.error;

      const blocks = [];
      for (const emp of target.employees) {
        for (const ex of emp.scheduleExceptions || []) {
          if (ex.endDate < from || ex.startDate > to) continue;
          blocks.push({
            profesional: emp.names,
            fechas: ex.startDate === ex.endDate ? dayLabel(ex.startDate) : `del ${dayLabel(ex.startDate)} al ${dayLabel(ex.endDate)}`,
            franja: ex.allDay ? "día completo" : `${ex.startTime}–${ex.endTime}`,
            ...(ex.recurrence ? { repite: ex.recurrence === "weekly" ? "semanal" : "mensual" } : {}),
            ...(ex.reason ? { motivo: ex.reason } : {}),
          });
        }
      }
      return {
        success: true,
        rango: `del ${dayLabel(from)} al ${dayLabel(to)}`,
        bloqueos: blocks,
        ...(blocks.length === 0 && { mensaje: "No hay bloqueos en ese rango." }),
      };
    },
  },

  {
    name: "unblock_employee_time",
    description:
      "QUITA bloqueos de agenda (días o franjas en rojo) de un profesional o de todos en una fecha o rango: 'quita la marca roja del 13', 'Diana sí trabaja el viernes, desbloquéalo'. Quita TODOS los bloqueos que caen en esas fechas (día completo o por horas); en un bloqueo de varios días solo libera las fechas pedidas. NUNCA uses block_employee_time para desbloquear.",
    parameters: {
      employeeName: { type: "string", description: "Nombre del profesional. Omítelo si allEmployees es true.", required: false },
      allEmployees: { type: "boolean", description: "true para quitar los bloqueos de todos los profesionales en esas fechas.", required: false },
      startDate: { type: "string", description: "Fecha de inicio YYYY-MM-DD", required: true },
      endDate: { type: "string", description: "Fecha de fin YYYY-MM-DD (igual a startDate si es un solo día)", required: false },
    },
    handler: async (params, context) => {
      const { organizationId } = context;
      const startDate = params.startDate;
      const endDate = params.endDate || params.startDate;
      if (!DATE_RE.test(startDate || "") || !DATE_RE.test(endDate)) {
        return { success: false, error: "Las fechas deben tener formato YYYY-MM-DD." };
      }
      if (startDate > endDate) {
        return { success: false, error: "La fecha de inicio debe ser anterior o igual a la de fin." };
      }
      const dates = [];
      for (let d = moment.utc(startDate, "YYYY-MM-DD"); d.format("YYYY-MM-DD") <= endDate; d.add(1, "day")) {
        dates.push(d.format("YYYY-MM-DD"));
        if (dates.length > 92) return { success: false, error: "El rango máximo es de 3 meses." };
      }

      const target = await resolveTargetEmployees(params, organizationId);
      if (target.error) return target.error;

      const removed = [];
      for (const emp of target.employees) {
        let changed = false;
        for (const date of dates) {
          const applying = (emp.scheduleExceptions || []).filter((ex) => scheduleService.exceptionAppliesToDate(ex, date));
          for (const ex of applying) {
            const franja = ex.allDay ? "día completo" : `${ex.startTime}–${ex.endTime}`;
            const r = scheduleService.removeExceptionDay(emp, ex, date);
            if (r.ok) {
              changed = true;
              removed.push(`${emp.names}: ${dayLabel(date)} (${franja})`);
            }
          }
        }
        if (changed) await emp.save();
      }

      if (removed.length === 0) {
        return {
          success: false,
          error: `No hay bloqueos ${dates.length === 1 ? `el ${dayLabel(startDate)}` : `entre el ${dayLabel(startDate)} y el ${dayLabel(endDate)}`} para ${target.employees.map((e) => e.names).join(", ")}.`,
          _instruction: "Díselo al usuario tal cual: no había nada que quitar en esas fechas. Si cree que sí hay una marca roja, usa get_employee_blocks para ver qué bloqueos existen.",
        };
      }
      return {
        success: true,
        quitados: removed,
        note: "Esos tiempos vuelven a ofrecerse en la reserva en línea (según el horario del profesional).",
      };
    },
  },
];
