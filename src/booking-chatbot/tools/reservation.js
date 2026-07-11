import mongoose from "mongoose";
import moment from "moment-timezone";
import Service from "../../models/serviceModel.js";
import Employee from "../../models/employeeModel.js";
import Appointment from "../../models/appointmentModel.js";
import scheduleService from "../../services/scheduleService.js";
import { normalizePhoneNumber } from "../../utils/phoneUtils.js";

// Resuelve un servicio: acepta ObjectId válido o nombre parcial. Devuelve el doc completo.
async function resolveService(value, organizationId) {
  if (mongoose.Types.ObjectId.isValid(value)) {
    const byId = await Service.findById(value).lean();
    if (byId) return byId;
  }
  // Intenta buscar por nombre (case-insensitive, coincidencia parcial)
  return Service.findOne({
    organizationId,
    name: { $regex: String(value).replace(/-/g, " "), $options: "i" },
    isActive: true,
  }).lean();
}

// Resuelve un employeeId: acepta ObjectId válido o nombre parcial.
async function resolveEmployeeId(value, organizationId) {
  if (!value) return null;
  if (mongoose.Types.ObjectId.isValid(value)) return value;
  const found = await Employee.findOne({
    organizationId,
    names: { $regex: String(value).replace(/-/g, " "), $options: "i" },
    isActive: true,
  }).lean();
  return found ? found._id.toString() : null;
}

// Auto-asigna empleado a los servicios sin preferencia, verificando que esté
// realmente disponible en el slot elegido (no solo que ofrezca el servicio).
// Muta `resolved` asignando employeeId a las entradas que lo tenían en null.
async function autoAssignAvailableEmployees(resolved, startDate, organization, organizationId) {
  const unassigned = resolved.filter((r) => !r.employeeId);
  if (unassigned.length === 0) return;

  const timezone = organization.timezone || "America/Bogota";
  const unassignedServiceIds = unassigned.map((r) => r.serviceId);

  // Candidatos: empleados activos que ofrecen TODOS los servicios sin asignar
  let candidates = await Employee.find({
    organizationId,
    isActive: true,
    services: { $all: unassignedServiceIds },
  }).lean();

  // Si nadie cubre todos juntos, caer al comportamiento por servicio individual
  if (candidates.length === 0) {
    for (const r of unassigned) {
      const emp = await Employee.findOne({
        organizationId,
        isActive: true,
        services: r.serviceId,
      }).lean();
      if (emp) r.employeeId = emp._id.toString();
    }
    return;
  }

  const date = String(startDate).slice(0, 10);
  const dayStart = moment.tz(date, timezone).startOf("day").toDate();
  const dayEnd = moment.tz(date, timezone).endOf("day").toDate();

  // Empleados con asignación fija (necesarios para evaluar la cadena completa)
  const fixedIds = resolved.filter((r) => r.employeeId).map((r) => r.employeeId);
  const fixedEmployees = fixedIds.length
    ? await Employee.find({ _id: { $in: fixedIds } }).lean()
    : [];

  const allEmployeeIds = [
    ...new Set([...fixedIds, ...candidates.map((c) => c._id.toString())]),
  ];
  const dayAppointments = await Appointment.find({
    organizationId: organization._id,
    employee: { $in: allEmployeeIds },
    startDate: { $gte: dayStart, $lte: dayEnd },
    status: { $nin: ["cancelled_by_customer", "cancelled_by_admin"] },
  }).lean();

  // Probar cada candidato: ¿la cadena completa de servicios cabe en el slot elegido?
  for (const emp of candidates) {
    const empId = emp._id.toString();
    const enriched = resolved.map((r) => ({
      serviceId: r.serviceId,
      employeeId: r.employeeId || empId,
      duration: r.duration,
      maxConcurrentAppointments: r.maxConcurrentAppointments,
    }));
    const employees = [...fixedEmployees.filter((f) => f._id.toString() !== empId), emp];
    const blocks = scheduleService.findAvailableMultiServiceBlocks(
      date,
      organization,
      enriched,
      employees,
      dayAppointments
    );
    if (blocks.some((b) => b.start === startDate)) {
      for (const r of resolved) {
        if (!r.employeeId) r.employeeId = empId;
      }
      return;
    }
  }

  // Ningún candidato libre exactamente en ese slot: asignar el primero y dejar
  // que la validación de conflictos del backend decida al crear la reserva.
  const fallbackId = candidates[0]._id.toString();
  for (const r of resolved) {
    if (!r.employeeId) r.employeeId = fallbackId;
  }
}

// Esta tool no crea la reserva directamente — prepara el payload para que el
// frontend lo confirme y llame al endpoint /api/reservations/multi existente.
export const prepareReservation = {
  name: "prepare_reservation",
  description:
    "Llama esto cuando tengas TODA la información necesaria y el usuario haya dicho que sí al resumen. Prepara el payload final para que el frontend cree la reserva al hacer clic en el botón de confirmación.",
  parameters: {
    services: {
      type: "array",
      description:
        "Array de servicios. Cada item: { serviceId, employeeId }. REGLA CRÍTICA: serviceId SIEMPRE debe ser el campo 'id' exacto que devolvió get_services. employeeId SIEMPRE debe ser el campo 'id' exacto que devolvió get_employees_for_service — NUNCA el nombre. Solo usa null si el cliente no expresó preferencia de profesional en ningún momento de la conversación.",
      items: { type: "object" },
      required: true,
    },
    startDate: {
      type: "string",
      description:
        "Fecha y hora de inicio en formato YYYY-MM-DDTHH:mm:ss (usa el campo isoString que devolvió get_available_slots)",
      required: true,
    },
    customerName: {
      type: "string",
      description: "Nombre completo del cliente",
      required: true,
    },
    customerPhone: {
      type: "string",
      description: "Teléfono del cliente (cualquier formato; se normaliza automáticamente)",
      required: false,
    },
    customerEmail: {
      type: "string",
      description: "Email del cliente",
      required: false,
    },
    customerDocumentId: {
      type: "string",
      description: "Número de documento del cliente",
      required: false,
    },
    notes: {
      type: "string",
      description: "Notas adicionales (opcional)",
      required: false,
    },
    customerBirthDate: {
      type: "string",
      description: "Fecha de nacimiento del cliente en formato YYYY-MM-DD (opcional). Conviértela si el usuario la dio en otro formato.",
      required: false,
    },
  },
  handler: async (params, context) => {
    const { organizationId, organization } = context;
    const {
      services,
      startDate,
      customerName,
      customerPhone,
      customerEmail,
      customerDocumentId,
      notes,
      customerBirthDate,
    } = params;

    if (!services?.length || !startDate || !customerName) {
      return { success: false, error: "Faltan datos requeridos para la reserva." };
    }

    // Resolver IDs (el AI a veces usa nombres en lugar de ObjectIds)
    const resolved = [];
    for (const s of services) {
      const svcDoc = await resolveService(s.serviceId, organizationId);
      if (!svcDoc) {
        return { success: false, error: `No se encontró el servicio: ${s.serviceId}. Usa el campo 'id' exacto que devolvió get_services.` };
      }
      const employeeId = await resolveEmployeeId(s.employeeId, organizationId);
      resolved.push({
        serviceId: svcDoc._id.toString(),
        employeeId,
        duration: svcDoc.duration || 30,
        maxConcurrentAppointments: svcDoc.maxConcurrentAppointments ?? 1,
      });
    }

    // Auto-asignar empleados disponibles en el slot a los servicios sin preferencia
    await autoAssignAvailableEmployees(resolved, startDate, organization, organizationId);

    // Normalizar teléfono a E.164 con el país del negocio (el cliente puede
    // escribirlo con espacios, guiones o sin código de país)
    let normalizedPhone = customerPhone || "";
    if (customerPhone) {
      const result = normalizePhoneNumber(customerPhone, organization.default_country || "CO");
      if (result.isValid) normalizedPhone = result.phone_e164;
    }

    // Validar y normalizar birthDate si se proporcionó
    let parsedBirthDate = null;
    if (customerBirthDate) {
      const d = new Date(customerBirthDate);
      if (!isNaN(d.getTime())) parsedBirthDate = d.toISOString();
    }

    const payload = {
      services: resolved.map(({ serviceId, employeeId }) => ({ serviceId, employeeId })),
      startDate,
      customerDetails: {
        name: customerName,
        phone: normalizedPhone,
        email: customerEmail || "",
        documentId: customerDocumentId || "",
        notes: notes || "",
        birthDate: parsedBirthDate,
      },
      organizationId: organizationId.toString(),
    };

    // En canal WhatsApp guardar el payload en la sesión para que confirm_reservation lo use
    if (context.session) {
      context.session.pendingPayload = payload;
    }

    return {
      success: true,
      payload,
      _instruction:
        context.channel === "whatsapp"
          ? "PAYLOAD LISTO. La reserva NO ha sido creada todavía. Pide al cliente que responda *sí* para confirmarla. Cuando confirme, llama confirm_reservation. NO digas que la reserva fue creada ni confirmada todavía."
          : "PAYLOAD LISTO. La reserva NO ha sido creada todavía. El frontend mostrará un botón al cliente. NO digas que la reserva fue creada, confirmada ni procesada. Di ÚNICAMENTE que el botón de confirmación ya está listo para que el cliente haga clic.",
    };
  },
};

// ── confirm_reservation (SOLO canal WhatsApp) ────────────────────────────────
// En la web la reserva la crea el frontend al hacer clic en el botón de
// confirmación. En WhatsApp no hay botón: cuando el cliente confirma por chat,
// esta tool crea la reserva invocando la misma lógica del endpoint
// POST /api/reservations/multi (respeta política auto/manual, notificaciones
// y mensajes de WhatsApp existentes) mediante un req/res simulado.

function makeMockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.body = obj;
    return res;
  };
  return res;
}

export const confirmReservation = {
  name: "confirm_reservation",
  description:
    "Crea DEFINITIVAMENTE la reserva preparada previamente con prepare_reservation. Llámala ÚNICAMENTE cuando el cliente acaba de confirmar de forma explícita (sí, dale, confirma, ok) y existe una reserva preparada en esta conversación. No recibe parámetros — usa el payload preparado.",
  parameters: {},
  handler: async (_params, context) => {
    const payload = context.session?.pendingPayload;
    if (!payload) {
      return {
        success: false,
        error:
          "No hay ninguna reserva preparada en esta conversación. Llama prepare_reservation primero con todos los datos.",
      };
    }

    // Import diferido para evitar ciclo de dependencias en la carga del módulo
    // (reservationController importa ChatLog y servicios que a su vez son usados aquí).
    const { default: reservationController } = await import(
      "../../controllers/reservationController.js"
    );

    const req = {
      body: {
        ...payload,
        source: "ai_chatbot",
        chatSessionId: context.sessionId,
      },
    };
    const res = makeMockRes();

    try {
      await reservationController.createMultipleReservations(req, res);
    } catch (err) {
      console.error("[confirm_reservation] Error creando reserva:", err);
      return { success: false, error: err.message || "Error al crear la reserva." };
    }

    if (res.statusCode >= 200 && res.statusCode < 300) {
      context.session.pendingPayload = null;
      context.session.reservationCreated = true;
      return {
        success: true,
        _instruction:
          "Reserva creada correctamente. Confirma al cliente que su reserva quedó agendada. Si la política del negocio es manual, aclara que el negocio la revisará y le confirmará.",
      };
    }

    return {
      success: false,
      error: res.body?.message || "No se pudo crear la reserva. El horario pudo haber sido tomado.",
      _instruction:
        "La reserva NO se creó. Explica el problema al cliente y ofrece buscar otro horario con get_available_slots.",
    };
  },
};
