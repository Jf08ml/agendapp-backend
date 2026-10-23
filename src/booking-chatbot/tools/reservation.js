import mongoose from "mongoose";
import moment from "moment-timezone";
import Service from "../../models/serviceModel.js";
import Employee from "../../models/employeeModel.js";
import Appointment from "../../models/appointmentModel.js";
import scheduleService from "../../services/scheduleService.js";
import packageService from "../../services/packageService.js";
import { normalizePhoneNumber } from "../../utils/phoneUtils.js";
import { getCustomFieldDefinitions, validateAndSplitCustomFieldValues } from "../../utils/customFieldUtils.js";
import { resolveBaseUrl } from "../../utils/cancellationUtils.js";
import { computeDepositForServices } from "../../services/collection/orderService.js";
import { dateLabel } from "./availability.js";
import { isPriceHidden } from "./services.js";

const ACTIVE_APPOINTMENT_FILTER = { $nin: ["cancelled_by_customer", "cancelled_by_admin"] };

const formatMoney = (amount, currency) =>
  `$${Number(amount).toLocaleString("es-CO", { maximumFractionDigits: 2 })} ${currency}`;

// Cómo se cobra el abono de una reserva: misma regla que BookingChatPanel.tsx
// (web) — Mercado Pago si está conectado salvo que el negocio prefiera
// comprobante; si no, transferencia + comprobante. null = no se cobra abono.
async function resolveDepositPlan(organization, services) {
  if (!organization.requireReservationDeposit) return null;
  const hasMp = !!organization.mpCollect?.connected;
  const hasReceipt = (organization.paymentMethods || []).length > 0;
  if (!hasMp && !hasReceipt) return null;

  const docs = await Service.find({ _id: { $in: services.map((s) => s.serviceId) } }).lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const deposit = computeDepositForServices(
    organization,
    services.map((s) => {
      const doc = byId.get(String(s.serviceId));
      return { _id: doc?._id, price: Number(doc?.price || 0), deposit: doc?.deposit };
    })
  );
  if (!deposit.required || deposit.total <= 0) return null;

  const useReceipt = hasReceipt && (organization.depositPreferredMethod === "receipt" || !hasMp);
  return { amount: deposit.total, currency: deposit.currency, method: useReceipt ? "receipt" : "mercadopago" };
}

// ¿La cadena de servicios cabe en `start` con los profesionales ya asignados?
// Misma fuente que get_available_slots: horario del negocio y del profesional,
// descansos, citas existentes y horas ya pasadas.
async function isSlotAvailable(resolved, start, organization) {
  const timezone = organization.timezone || "America/Bogota";
  const date = start.slice(0, 10);
  const employeeIds = [...new Set(resolved.map((r) => r.employeeId))];
  const employees = await Employee.find({ _id: { $in: employeeIds } }).lean();
  const dayAppointments = await Appointment.find({
    organizationId: organization._id,
    employee: { $in: employeeIds },
    startDate: {
      $gte: moment.tz(date, timezone).startOf("day").toDate(),
      $lte: moment.tz(date, timezone).endOf("day").toDate(),
    },
    status: ACTIVE_APPOINTMENT_FILTER,
  }).lean();
  const blocks = scheduleService.findAvailableMultiServiceBlocks(
    date,
    organization,
    resolved,
    employees,
    dayAppointments
  );
  return blocks.some((b) => b.start === start);
}

// Busca un paquete de sesiones activo del cliente que cubra TODOS los
// servicios solicitados (con sesiones disponibles en cada uno). El endpoint
// de reserva solo admite un clientPackageId por reserva, aplicado a todos los
// servicios del batch — por eso exigimos cobertura total: aplicar un paquete
// que solo cubre parte de los servicios dejaría sesiones/servicios sin cobrar
// mal descontados a $0. Si no hay cobertura total, no se aplica ningún
// paquete y la reserva sigue el flujo de pago normal.
async function findCoveringPackage(phone_e164, serviceIds, organizationId) {
  if (!phone_e164) return null;
  try {
    const { packages } = await packageService.checkClientPackagesByPhone(
      phone_e164,
      serviceIds,
      organizationId
    );
    const covering = (packages || []).find((pkg) =>
      serviceIds.every((sid) =>
        (pkg.services || []).some((svc) => {
          const svcId = (svc.serviceId?._id || svc.serviceId)?.toString();
          return svcId === sid && svc.sessionsRemaining > 0;
        })
      )
    );
    if (!covering) return null;
    return {
      clientPackageId: covering._id.toString(),
      packageName: covering.servicePackageId?.name || "tu paquete de sesiones",
    };
  } catch (err) {
    console.error("[booking-chatbot] Error verificando paquetes del cliente:", err);
    return null;
  }
}

// Resuelve un servicio: acepta ObjectId válido o nombre parcial. Devuelve el doc completo.
async function resolveService(value, organizationId) {
  if (mongoose.Types.ObjectId.isValid(value)) {
    const byId = await Service.findOne({ _id: value, organizationId }).lean();
    if (byId) return byId;
  }
  // Intenta buscar por nombre (case-insensitive, coincidencia parcial)
  return Service.findOne({
    organizationId,
    name: { $regex: String(value).replace(/-/g, " "), $options: "i" },
    isActive: true,
  }).lean();
}

// Resuelve un employeeId: acepta ObjectId válido o nombre parcial. Solo devuelve
// profesionales activos del negocio que atienden el servicio — antes cualquier
// ObjectId pasaba tal cual. Un nombre inventado (caso real 2026-10-22: "Diana
// Vargas", tomado del nombre del negocio) queda en null y se auto-asigna.
async function resolveEmployeeId(value, organizationId, serviceId) {
  if (!value) return null;
  const filter = { organizationId, isActive: true, services: serviceId };
  const found = mongoose.Types.ObjectId.isValid(value)
    ? await Employee.findOne({ ...filter, _id: value }).select("_id").lean()
    : await Employee.findOne({
        ...filter,
        names: { $regex: String(value).replace(/-/g, " "), $options: "i" },
      }).select("_id").lean();
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
    "Prepara una reserva NUEVA cuando tengas TODA la información necesaria. Valida que el horario esté realmente disponible y no crea nada. " +
    "Web: llámala cuando el usuario diga que sí al resumen — el frontend crea la reserva con el botón de confirmación. " +
    "WhatsApp: llámala ANTES de mostrar el resumen — devuelve summaryText, el resumen oficial que debes enviarle al cliente. " +
    "NO la uses para mover una cita que el cliente ya tiene agendada — eso crearía una cita duplicada. Para reprogramar una cita existente usa reschedule_appointment.",
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
      description: "Teléfono del cliente (cualquier formato; se normaliza automáticamente). Obligatorio en todas las reservas.",
      required: true,
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
    customFieldValues: {
      type: "object",
      description: "Mapa clave-valor de los datos adicionales que esta organización requiere, SOLO si el system prompt los lista (sección 'Esta organización además requiere...'). Usa exactamente las claves indicadas ahí. Omite este parámetro por completo si la organización no tiene campos adicionales.",
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
      customFieldValues: rawCustomFieldValues,
    } = params;

    // WhatsApp: una preparación nueva reemplaza a la anterior, también si falla —
    // así un "sí" posterior nunca confirma un resumen viejo.
    if (context.session) {
      context.session.pendingPayload = null;
      context.session.pendingSummary = null;
      context.session.pendingSummaryShown = false;
    }

    if (!services?.length || !startDate || !customerName) {
      return { success: false, error: "Faltan datos requeridos para la reserva." };
    }

    // El teléfono es obligatorio SIEMPRE: POST /reservations/multi lo exige aunque
    // el identificador del negocio sea email o documento. Sin esta validación la
    // tarjeta de confirmación fallaba con "Datos incompletos" (casos reales sep-2026).
    if (!customerPhone) {
      return {
        success: false,
        error: "Falta el teléfono del cliente.",
        _instruction:
          "El teléfono es obligatorio en todas las reservas (se usa para la confirmación por WhatsApp). Pídeselo al cliente y vuelve a llamar prepare_reservation.",
      };
    }
    const identifierField = organization.clientFormConfig?.identifierField || "phone";
    if (identifierField === "email" && !customerEmail) {
      return {
        success: false,
        error: "Falta el correo del cliente (es el identificador de este negocio).",
        _instruction: "Pídele al cliente su correo electrónico y vuelve a llamar prepare_reservation.",
      };
    }
    if (identifierField === "documentId" && !customerDocumentId) {
      return {
        success: false,
        error: "Falta el número de documento del cliente (es el identificador de este negocio).",
        _instruction: "Pídele al cliente su número de documento y vuelve a llamar prepare_reservation.",
      };
    }

    // Validar campos personalizados de la organización (si tiene configurados) ANTES
    // de armar el payload — así el modelo recibe un error conversacional claro (ej.
    // "falta el número de siniestro") en vez de que la reserva falle más adelante.
    const customFieldDefs = getCustomFieldDefinitions(organization.clientFormConfig?.fields);
    if (customFieldDefs.length > 0) {
      try {
        validateAndSplitCustomFieldValues(customFieldDefs, rawCustomFieldValues);
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    const timezone = organization.timezone || "America/Bogota";
    const startMoment = moment.tz(
      String(startDate).slice(0, 19),
      ["YYYY-MM-DDTHH:mm:ss", "YYYY-MM-DDTHH:mm"],
      true,
      timezone
    );
    if (!startMoment.isValid()) {
      return {
        success: false,
        error: `Fecha/hora inválida: ${startDate}.`,
        _instruction: "Usa como startDate el campo isoString exacto que devolvió get_available_slots.",
      };
    }
    const start = startMoment.format("YYYY-MM-DDTHH:mm:ss");

    // Resolver IDs (el AI a veces usa nombres en lugar de ObjectIds)
    const resolved = [];
    for (const s of services) {
      const svcDoc = await resolveService(s.serviceId, organizationId);
      if (!svcDoc) {
        return { success: false, error: `No se encontró el servicio: ${s.serviceId}. Usa el campo 'id' exacto que devolvió get_services.` };
      }
      const employeeId = await resolveEmployeeId(s.employeeId, organizationId, svcDoc._id);
      resolved.push({
        serviceId: svcDoc._id.toString(),
        employeeId,
        duration: svcDoc.duration || 30,
        maxConcurrentAppointments: svcDoc.maxConcurrentAppointments ?? 1,
        name: svcDoc.name,
        price: Number(svcDoc.price || 0),
        priceHidden: isPriceHidden(svcDoc, String(organization.currency || "COP").toUpperCase()),
      });
    }

    // Auto-asignar empleados disponibles en el slot a los servicios sin preferencia
    await autoAssignAvailableEmployees(resolved, start, organization, organizationId);

    if (resolved.some((r) => !r.employeeId)) {
      return {
        success: false,
        error: "Ningún profesional activo atiende este servicio.",
        _instruction:
          "Este servicio no se puede reservar en línea. Díselo al cliente con amabilidad y ofrécele otro servicio o el contacto del negocio (get_organization_info). NO inventes profesionales.",
      };
    }

    // El modelo puede proponer una hora que nunca consultó (caso real 2026-10-22:
    // "jueves 9am" agendado hoy a las 3 p. m., sin llamar get_available_slots).
    if (!(await isSlotAvailable(resolved, start, organization))) {
      return {
        success: false,
        error: `El horario ${start} no está disponible (ya pasó, está fuera del horario o está ocupado).`,
        _instruction:
          "NO ofrezcas ni confirmes ese horario. Llama get_available_slots para esa fecha (o get_available_dates si ya no hay cupos ese día) y ofrécele al cliente los horarios reales.",
      };
    }

    // Normalizar teléfono a E.164 con el país del negocio (el cliente puede
    // escribirlo con espacios, guiones o sin código de país)
    // Un número inválido se rechaza aquí: antes pasaba tal cual y el cliente se
    // enteraba recién al tocar el botón ("dice que el número está mal").
    const phoneResult = normalizePhoneNumber(customerPhone, organization.default_country || "CO");
    if (!phoneResult.isValid) {
      return {
        success: false,
        error: `El teléfono "${customerPhone}" no parece válido.`,
        _instruction:
          "Pídele al cliente que verifique su número (sin dígitos de más ni de menos; con código de país si no es del país del negocio) y vuelve a llamar prepare_reservation.",
      };
    }
    const normalizedPhone = phoneResult.phone_e164;

    // Validar y normalizar birthDate si se proporcionó
    let parsedBirthDate = null;
    if (customerBirthDate) {
      const d = new Date(customerBirthDate);
      if (!isNaN(d.getTime())) parsedBirthDate = d.toISOString();
    }

    // 📦 Detectar paquete de sesiones que cubra TODOS los servicios pedidos —
    // si existe, la reserva se paga con el paquete (precio $0, no se cobra
    // depósito) en vez del flujo de pago normal.
    const requestedServiceIds = resolved.map((r) => r.serviceId);
    const coveringPackage = await findCoveringPackage(
      normalizedPhone,
      requestedServiceIds,
      organizationId
    );

    const payload = {
      services: resolved.map(({ serviceId, employeeId }) => ({ serviceId, employeeId })),
      startDate: start,
      customerDetails: {
        name: customerName,
        phone: normalizedPhone,
        email: customerEmail || "",
        documentId: customerDocumentId || "",
        notes: notes || "",
        birthDate: parsedBirthDate,
      },
      organizationId: organizationId.toString(),
      ...(coveringPackage ? { clientPackageId: coveringPackage.clientPackageId } : {}),
      ...(rawCustomFieldValues && Object.keys(rawCustomFieldValues).length > 0
        ? { customFieldValues: rawCustomFieldValues }
        : {}),
    };

    // En canal WhatsApp guardar el payload en la sesión para que confirm_reservation lo use
    if (context.session) {
      context.session.pendingPayload = payload;
    }

    const packageNote = coveringPackage
      ? ` Esta reserva se paga con ${coveringPackage.packageName} del cliente — el costo es $0, NO menciones un precio a pagar ni pidas depósito, solo confirma que se descuenta de su paquete.`
      : "";

    if (context.channel !== "whatsapp") {
      return {
        success: true,
        payload,
        usingPackage: !!coveringPackage,
        packageName: coveringPackage?.packageName || null,
        _instruction:
          "PAYLOAD LISTO. La reserva NO ha sido creada todavía. El frontend mostrará un botón al cliente. NO digas que la reserva fue creada, confirmada ni procesada. Di ÚNICAMENTE que el botón de confirmación ya está listo para que el cliente haga clic." +
          packageNote,
      };
    }

    // WhatsApp: no hay tarjeta de confirmación, así que el resumen que ve el
    // cliente se arma aquí con los datos ya resueltos. Antes lo redactaba el
    // modelo de memoria ANTES de esta tool y llegó a nombrar a una profesional
    // que no existe (caso real 2026-10-22).
    const currency = String(organization.currency || "COP").toUpperCase();
    const employeeNames = new Map(
      (await Employee.find({ _id: { $in: resolved.map((r) => r.employeeId) } }).select("names").lean())
        .map((e) => [e._id.toString(), e.names])
    );
    const timeLabel = new Intl.DateTimeFormat("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: (organization.timeFormat || "12h") !== "24h",
      timeZone: timezone,
    }).format(startMoment.toDate());
    const dayLabel = dateLabel(start.slice(0, 10), timezone);
    const depositPlan = coveringPackage ? null : await resolveDepositPlan(organization, payload.services);

    const lines = ["📋 *Resumen de tu reserva*", ""];
    for (const r of resolved) {
      lines.push(`✨ *${r.name}* con ${employeeNames.get(r.employeeId) || "nuestro equipo"}`);
    }
    lines.push(`📅 ${dayLabel.charAt(0).toUpperCase()}${dayLabel.slice(1)}, ${timeLabel}`);
    lines.push(`👤 ${customerName}`);
    lines.push(`📱 ${normalizedPhone}`);
    for (const def of customFieldDefs) {
      const value = rawCustomFieldValues?.[def.key];
      if (value !== undefined && value !== null && value !== "") lines.push(`📝 ${def.label || def.key}: ${value}`);
    }
    if (coveringPackage) {
      lines.push(`📦 Se descuenta de ${coveringPackage.packageName} (sin costo)`);
    } else if (resolved.every((r) => !r.priceHidden)) {
      lines.push(`💰 Precio: ${formatMoney(resolved.reduce((sum, r) => sum + r.price, 0), currency)}`);
    } else {
      lines.push("💰 Precio: se confirma directamente con el negocio");
    }
    if (depositPlan) {
      lines.push(
        `💳 Abono para confirmar: *${formatMoney(depositPlan.amount, depositPlan.currency)}* — apenas confirmes te envío el enlace para pagarlo.`
      );
    }
    const summaryText = lines.join("\n");
    if (context.session) context.session.pendingSummary = summaryText;

    return {
      success: true,
      payload,
      summaryText,
      usingPackage: !!coveringPackage,
      _instruction:
        "RESUMEN LISTO — la reserva NO está creada. Envía al cliente summaryText tal cual y pregúntale \"¿Todo está correcto? ¿Confirmo tu reserva?\". NO llames confirm_reservation en esta respuesta: espera a que el cliente responda que sí.",
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

// Crea el checkout del abono reutilizando los mismos controllers que la web
// (POST /mp/... y /collection/receipt/reservation) con un req/res simulado. Las
// reservas quedan en pending y se aprueban solas cuando el pago se valida.
async function startDepositCheckout(payload, depositPlan, context) {
  const isMp = depositPlan.method === "mercadopago";
  const { createReservationCheckout } = await import("../../controllers/collectionController.js");
  const { createReceiptReservationCheckout } = await import("../../controllers/receiptController.js");

  const res = makeMockRes();
  try {
    await (isMp ? createReservationCheckout : createReceiptReservationCheckout)(
      { body: { ...payload, source: "ai_chatbot" } },
      res
    );
  } catch (err) {
    console.error("[confirm_reservation] Error creando el cobro del abono:", err);
    return { success: false, error: err.message || "No se pudo generar el pago del abono." };
  }

  const data = res.body?.data;
  if (res.statusCode < 200 || res.statusCode >= 300 || !data) {
    return {
      success: false,
      error: res.body?.message || "No se pudo generar el pago del abono.",
      _instruction:
        "La reserva NO se apartó. Explica el problema al cliente y ofrece buscar otro horario con get_available_slots.",
    };
  }

  const paymentUrl = isMp
    ? data.checkoutUrl
    : `${resolveBaseUrl(context.organization)}/pago/comprobante?ref=${data.externalReference}`;
  const holdMinutes = Math.max(1, Math.round((new Date(data.expiresAt).getTime() - Date.now()) / 60000));
  const amountLabel = formatMoney(data.amount, data.currency);

  context.session.pendingPayload = null;
  context.session.pendingSummary = null;
  context.session.pendingDeposit = { paymentUrl, amountLabel, expiresAt: data.expiresAt, method: depositPlan.method };
  context.session.hasConfirmedBookingThisSession = true;

  return {
    success: true,
    paymentRequired: true,
    paymentUrl,
    depositAmount: amountLabel,
    holdMinutes,
    _instruction:
      `La reserva quedó APARTADA, todavía NO confirmada: se confirma cuando el cliente pague el abono de ${amountLabel}. ` +
      `Dile que tiene ${holdMinutes} minutos para pagarlo en el enlace paymentUrl (cópialo completo, tal cual) — ` +
      (isMp
        ? "puede pagar con Mercado Pago. "
        : "ahí verá los datos para transferir y sube la foto del comprobante. ") +
      "Si no lo paga a tiempo el horario se libera. Cuando el pago se valide recibirá la confirmación por WhatsApp. NO digas que la reserva ya está confirmada.",
  };
}

// Respuesta afirmativa explícita del cliente al resumen ("sí", "dale",
// "confirmo", "agéndeme"...). Caso real (Diana Vargas Studio, 2026-10-23): a
// "¿Confirmo tu reserva?" la clienta respondió "Ya está echo un abono de 25" y el
// modelo lo tomó como un sí — se apartó la reserva y se le dijo que ya había pagado.
const AFFIRMATIVE_PATTERN =
  /^\s*(s[ií]+|dale|ok(ay|i)?|listo|confirm[oa]?|claro|perfecto|h[aá]gale|de una|correcto|est[aá] bien|de acuerdo|por ?favor|ag[eé]nd[ae]me|ag[eé]nd[ae]la|reserv[ae]la|va|vale|bueno,? s[ií])(?![\wáéíóúñ])/i;

export function isExplicitConfirmation(text) {
  return AFFIRMATIVE_PATTERN.test(String(text || ""));
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
    // El cliente tiene que haber visto el resumen oficial antes de confirmar.
    if (context.session.pendingSummaryShown === false) {
      return {
        success: false,
        error: "El cliente todavía no ha visto el resumen de esta reserva.",
        _instruction:
          "Envíale el resumen (summaryText de prepare_reservation) y espera a que responda que sí antes de llamar confirm_reservation.",
      };
    }
    // Y su último mensaje tiene que ser un sí explícito — una pregunta, un
    // comentario o un "ya pagué" no confirman nada.
    const lastUserText = [...(context.session.messages || [])]
      .reverse()
      .find((m) => m.role === "user" && typeof m.content === "string")?.content;
    if (!isExplicitConfirmation(lastUserText)) {
      return {
        success: false,
        error: "El cliente no confirmó explícitamente el resumen en su último mensaje.",
        _instruction:
          "NO se creó nada. Responde a lo que el cliente dijo en su último mensaje y, si sigue interesado, pregúntale de nuevo si confirma la reserva.",
      };
    }

    // 💳 Pay-to-confirm: igual que en la web, si el negocio exige abono la reserva
    // no se crea directo — se abre el cobro (reserva apartada con hold) y se le
    // envía el enlace al cliente. Antes el bot prometía "el abono lo pagas en el
    // siguiente paso" y la cita quedaba confirmada sin cobrar nada.
    const depositPlan = payload.clientPackageId
      ? null
      : await resolveDepositPlan(context.organization, payload.services);
    if (depositPlan) {
      return startDepositCheckout(payload, depositPlan, context);
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
      const usedPackage = !!payload.clientPackageId;
      context.session.pendingPayload = null;
      context.session.pendingSummary = null;
      context.session.reservationCreated = true;
      context.session.hasConfirmedBookingThisSession = true;
      return {
        success: true,
        _instruction:
          "Reserva creada correctamente. Confirma al cliente que su reserva quedó agendada. Si la política del negocio es manual, aclara que el negocio la revisará y le confirmará." +
          (usedPackage
            ? " Recuérdale que esta sesión se descontó de su paquete y que no debe pagar nada por ella."
            : ""),
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
