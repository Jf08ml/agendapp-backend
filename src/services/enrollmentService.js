// src/services/enrollmentService.js
import crypto from "crypto";
import { Types } from "mongoose";
import Enrollment from "../models/enrollmentModel.js";
import ClassSession from "../models/classSessionModel.js";
import Class from "../models/classModel.js";
import Client from "../models/clientModel.js";
import Organization from "../models/organizationModel.js";
import { normalizePhoneNumber } from "../utils/phoneUtils.js";
import { waIntegrationService } from "./waIntegrationService.js";
import whatsappTemplates from "../utils/whatsappTemplates.js";
import moment from "moment-timezone";
import notificationService from "./notificationService.js";
import subscriptionService from "./subscriptionService.js";

// ══════════════════════════════════════════════════════
// HELPERS INTERNOS
// ══════════════════════════════════════════════════════

function generateToken() {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

/**
 * Calcula el porcentaje de descuento a aplicar según la config grupal y el número de personas.
 */
function computeDiscountPercent(groupDiscount, numPeople) {
  if (!groupDiscount?.enabled) return 0;
  if (numPeople < groupDiscount.minPeople) return 0;
  if (groupDiscount.maxPeople && numPeople > groupDiscount.maxPeople) return 0;
  return groupDiscount.discountPercent || 0;
}

/**
 * Calcula el precio final por persona con el descuento aplicado.
 * Redondea al entero más cercano.
 */
function computeTotalPrice(pricePerPerson, discountPercent) {
  return Math.round(pricePerPerson * (1 - discountPercent / 100));
}

/**
 * Busca o crea un cliente usando el identifierField configurado por la organización.
 */
async function findOrCreateClient(organizationId, attendee, org) {
  const identifierField = org?.clientFormConfig?.identifierField || "phone";

  // Normalizar teléfono (siempre, aunque no sea el identificador)
  const normalized = normalizePhoneNumber(
    attendee.phone || attendee.phone_e164 || "",
    attendee.phone_country || org?.default_country || "CO"
  );
  const phone_e164 = normalized?.isValid ? normalized.phone_e164 : (attendee.phone_e164 || attendee.phone || null);

  // Construir query de búsqueda según el identificador configurado
  let lookupQuery = { organizationId };
  if (identifierField === "phone") {
    if (!phone_e164) return null;
    lookupQuery.$or = [{ phone_e164 }, { phoneNumber: normalized?.phone_national_clean }].filter(c => Object.values(c)[0]);
  } else if (identifierField === "email") {
    if (!attendee.email) return null;
    lookupQuery.email = attendee.email.toLowerCase().trim();
  } else if (identifierField === "documentId") {
    if (!attendee.documentId) return null;
    lookupQuery.documentId = attendee.documentId.trim();
  }

  let client = await Client.findOne(lookupQuery);
  if (!client) {
    client = new Client({
      organizationId,
      name: attendee.name,
      phoneNumber: normalized?.phone_national_clean || attendee.phone || null,
      phone_e164: phone_e164 || null,
      phone_country: attendee.phone_country || null,
      email: attendee.email || null,
      documentId: attendee.documentId || null,
      notes: attendee.notes || null,
    });
    await client.save();
  }
  return client;
}

/**
 * Envía WhatsApp de confirmación de inscripción a un asistente.
 * Los errores son silenciosos (no deben fallar el flujo principal).
 */
async function sendEnrollmentWhatsApp(templateType, organizationId, enrollment, session, classDoc, org) {
  try {
    const phone = enrollment.attendee?.phone_e164 || enrollment.attendee?.phone;
    if (!phone) return;

    const tz = org.timezone || "America/Bogota";
    const startMoment = moment(session.startDate).tz(tz);
    const endMoment = moment(session.endDate).tz(tz);

    const templateData = {
      names: enrollment.attendee.name,
      organization: org.name,
      address: org.address || "",
      className: classDoc.name,
      date: startMoment.format("dddd D [de] MMMM [de] YYYY"),
      startTime: startMoment.format("h:mm A"),
      endTime: endMoment.format("h:mm A"),
      price: `$${enrollment.totalPrice.toLocaleString("es-CO")}`,
      discount:
        enrollment.discountPercent > 0
          ? `🎉 Descuento grupal del ${enrollment.discountPercent}% aplicado\n`
          : "",
    };

    const msg = await whatsappTemplates.getRenderedTemplate(
      organizationId,
      templateType,
      templateData
    );
    if (!msg) return;

    await waIntegrationService.sendMessage({
      orgId: organizationId,
      phone,
      message: msg,
      image: null,
    });
  } catch (err) {
    console.error(`[enrollmentService] Error enviando WA (${templateType}):`, err.message);
  }
}

// ══════════════════════════════════════════════════════
// CREACIÓN DE INSCRIPCIONES (flujo público)
// ══════════════════════════════════════════════════════

/**
 * Crea una o dos inscripciones (titular + acompañante opcional).
 * Valida cupo, calcula descuento, incrementa enrolledCount atómicamente.
 *
 * @param {Object} params
 * @param {string} params.organizationId
 * @param {string} params.sessionId
 * @param {Object} params.attendee       - { name, phone, phone_e164, phone_country, email }
 * @param {Object} [params.companion]    - datos del acompañante (opcional)
 * @param {string} [params.notes]
 */
async function createPublicEnrollments({ organizationId, sessionId, attendee, companion, notes }) {
  const numPeople = companion ? 2 : 1;

  // 1. Cargar sesión y clase
  const session = await ClassSession.findById(sessionId).populate("classId");
  if (!session) throw new Error("Sesión no encontrada");
  if (session.status === "cancelled") throw new Error("Esta sesión fue cancelada");
  if (session.status === "completed") throw new Error("Esta sesión ya finalizó");
  if (session.organizationId.toString() !== organizationId.toString()) {
    throw new Error("La sesión no pertenece a esta organización");
  }

  const classDoc = session.classId;

  // 2. Reservar cupos atómicamente
  const updatedSession = await ClassSession.findOneAndUpdate(
    {
      _id: sessionId,
      status: { $in: ["open"] },
      $expr: { $lte: [{ $add: ["$enrolledCount", numPeople] }, "$capacity"] },
    },
    { $inc: { enrolledCount: numPeople } },
    { new: true }
  );
  if (!updatedSession) {
    throw new Error("No hay cupos suficientes disponibles para esta sesión");
  }

  // Si se llenó el cupo, actualizar status a 'full'
  if (updatedSession.enrolledCount >= updatedSession.capacity) {
    updatedSession.status = "full";
    await updatedSession.save();
  }

  // 3. Calcular precios
  const discountPercent = computeDiscountPercent(classDoc.groupDiscount, numPeople);
  const totalPrice = computeTotalPrice(classDoc.pricePerPerson, discountPercent);

  // 4. Determinar modo de aprobación de la organización
  const org = await Organization.findById(organizationId);
  const approvalMode = org?.reservationPolicy?.autoApprove ? "auto" : "manual";
  const initialStatus = approvalMode === "auto" ? "confirmed" : "pending";

  // 5. groupId compartido si hay acompañante
  const groupId = companion ? new Types.ObjectId() : null;

  // 6. Buscar o crear clientes
  const mainClient = await findOrCreateClient(organizationId, attendee, org);
  const companionClient = companion ? await findOrCreateClient(organizationId, companion, org) : null;

  // 7. Crear inscripciones
  const enrollmentsData = [{ attendeeData: attendee, client: mainClient }];
  if (companion) {
    enrollmentsData.push({ attendeeData: companion, client: companionClient });
  }

  const created = [];
  for (const { attendeeData, client } of enrollmentsData) {
    const { token, hash } = generateToken();
    const normalized = normalizePhoneNumber(
      attendeeData.phone,
      attendeeData.phone_country || "CO"
    );

    const enrollment = new Enrollment({
      sessionId,
      classId: classDoc._id,
      organizationId,
      groupId,
      clientId: client?._id || null,
      attendee: {
        name: attendeeData.name,
        phone: attendeeData.phone,
        phone_e164: normalized?.e164 || attendeeData.phone,
        phone_country: attendeeData.phone_country || null,
        email: attendeeData.email || null,
      },
      pricePerPerson: classDoc.pricePerPerson,
      discountPercent,
      totalPrice,
      status: initialStatus,
      approvalMode,
      cancelTokenHash: hash,
      notes: notes || "",
    });

    await enrollment.save();
    // Guardar el token en el objeto para enviarlo en la respuesta (solo en creación)
    enrollment._cancelToken = token;
    created.push(enrollment);
  }

  // 8. Enviar WhatsApp solo si la inscripción fue auto-aprobada.
  //    Si es aprobación manual, el WA se envía cuando el admin aprueba.
  if (initialStatus === "confirmed") {
    for (const enrollment of created) {
      await sendEnrollmentWhatsApp("classEnrollmentConfirmed", organizationId, enrollment, updatedSession, classDoc, org);
    }
  }

  // 9. Notificar al admin (BD + push). Silencioso para no afectar el flujo.
  try {
    const attendeeName = attendee.name;
    const title = initialStatus === "confirmed"
      ? "Nueva inscripción a clase"
      : "Nueva inscripción pendiente";
    const message = initialStatus === "confirmed"
      ? `${attendeeName} se inscribió en ${classDoc.name}`
      : `${attendeeName} solicitó inscribirse en ${classDoc.name}. Pendiente de aprobación.`;

    await notificationService.createNotification({
      title,
      message,
      organizationId,
      type: "reservation",
      frontendRoute: "/gestionar-clases",
      status: "unread",
    });

    await subscriptionService.sendNotificationToUser(
      organizationId,
      JSON.stringify({
        title,
        message,
        icon: org?.branding?.pwaIcon,
      })
    );
  } catch (e) {
    console.warn("[enrollmentService] Error enviando notificación al admin:", e?.message || e);
  }

  return created;
}

// ══════════════════════════════════════════════════════
// CREACIÓN DIRECTA POR ADMIN
// ══════════════════════════════════════════════════════

/**
 * El admin crea inscripciones directamente (siempre confirmadas).
 * Puede modificar el precio manualmente.
 *
 * @param {Object} params
 * @param {string} params.organizationId
 * @param {string} params.sessionId
 * @param {Array}  params.attendees       - [{ name, phone, phone_country, email, customPrice? }]
 * @param {boolean} params.applyDiscount  - si true, aplica descuento grupal según config
 * @param {string}  [params.notes]
 */
async function adminCreateEnrollments({ organizationId, sessionId, attendees, applyDiscount = true, notes }) {
  if (!attendees?.length) throw new Error("Se requiere al menos un asistente");
  const numPeople = attendees.length;

  const session = await ClassSession.findById(sessionId).populate("classId");
  if (!session) throw new Error("Sesión no encontrada");
  if (session.status === "cancelled") throw new Error("Esta sesión fue cancelada");
  if (session.organizationId.toString() !== organizationId.toString()) {
    throw new Error("La sesión no pertenece a esta organización");
  }

  const classDoc = session.classId;
  const org = await Organization.findById(organizationId);

  // Reservar cupos atómicamente
  const updatedSession = await ClassSession.findOneAndUpdate(
    {
      _id: sessionId,
      status: { $nin: ["cancelled"] },
      $expr: { $lte: [{ $add: ["$enrolledCount", numPeople] }, "$capacity"] },
    },
    { $inc: { enrolledCount: numPeople } },
    { new: true }
  );
  if (!updatedSession) {
    throw new Error("No hay cupos suficientes disponibles para esta sesión");
  }
  if (updatedSession.enrolledCount >= updatedSession.capacity) {
    updatedSession.status = "full";
    await updatedSession.save();
  }

  const discountPercent = applyDiscount
    ? computeDiscountPercent(classDoc.groupDiscount, numPeople)
    : 0;

  const groupId = numPeople > 1 ? new Types.ObjectId() : null;
  const created = [];

  for (const attendeeData of attendees) {
    const client = await findOrCreateClient(organizationId, attendeeData, org);
    const { token, hash } = generateToken();
    const normalized = normalizePhoneNumber(
      attendeeData.phone,
      attendeeData.phone_country || "CO"
    );

    // El admin puede sobreescribir el precio por persona
    const finalPrice =
      attendeeData.customPrice !== undefined && attendeeData.customPrice !== null
        ? attendeeData.customPrice
        : computeTotalPrice(classDoc.pricePerPerson, discountPercent);

    const enrollment = new Enrollment({
      sessionId,
      classId: classDoc._id,
      organizationId,
      groupId,
      clientId: client?._id || null,
      attendee: {
        name: attendeeData.name,
        phone: attendeeData.phone,
        phone_e164: normalized?.e164 || attendeeData.phone,
        phone_country: attendeeData.phone_country || null,
        email: attendeeData.email || null,
      },
      pricePerPerson: classDoc.pricePerPerson,
      discountPercent: attendeeData.customPrice !== undefined ? 0 : discountPercent,
      totalPrice: finalPrice,
      status: "confirmed",
      approvalMode: "auto",
      cancelTokenHash: hash,
      notes: notes || "",
    });

    await enrollment.save();
    enrollment._cancelToken = token;
    created.push(enrollment);
  }

  // Notificar a cada asistente
  for (const enrollment of created) {
    await sendEnrollmentWhatsApp("classEnrollmentConfirmed", organizationId, enrollment, updatedSession, classDoc, org);
  }

  return created;
}

// ══════════════════════════════════════════════════════
// APROBACIÓN (flujo manual)
// ══════════════════════════════════════════════════════

/**
 * El admin aprueba una inscripción pendiente.
 * Si tiene groupId, aprueba todas las del grupo.
 */
async function approveEnrollment(enrollmentId) {
  const enrollment = await Enrollment.findById(enrollmentId)
    .populate("sessionId")
    .populate("classId");
  if (!enrollment) throw new Error("Inscripción no encontrada");
  if (enrollment.status !== "pending") {
    throw new Error(`No se puede aprobar una inscripción en estado "${enrollment.status}"`);
  }

  const org = await Organization.findById(enrollment.organizationId);

  // Aprobar toda la inscripción de grupo si corresponde
  const toApprove = enrollment.groupId
    ? await Enrollment.find({ groupId: enrollment.groupId, status: "pending" })
    : [enrollment];

  for (const e of toApprove) {
    e.status = "confirmed";
    await e.save();
    await sendEnrollmentWhatsApp(
      "classEnrollmentConfirmed",
      e.organizationId,
      e,
      enrollment.sessionId,
      enrollment.classId,
      org
    );
  }

  return toApprove;
}

// ══════════════════════════════════════════════════════
// CANCELACIÓN
// ══════════════════════════════════════════════════════

/**
 * Cancela una inscripción y decrementa el enrolledCount de la sesión.
 * @param {string} enrollmentId
 * @param {"customer"|"admin"} cancelledBy
 */
async function cancelEnrollment(enrollmentId, cancelledBy = "admin") {
  const enrollment = await Enrollment.findById(enrollmentId)
    .populate("sessionId")
    .populate("classId");
  if (!enrollment) throw new Error("Inscripción no encontrada");
  if (["cancelled"].includes(enrollment.status)) {
    throw new Error("La inscripción ya está cancelada");
  }

  const previousStatus = enrollment.status;
  enrollment.status = "cancelled";
  enrollment.cancelledBy = cancelledBy;
  enrollment.cancelledAt = new Date();
  await enrollment.save();

  // Solo decrementar si estaba confirmada (las pendientes no ocupan cupo confirmado
  // pero sí reservamos el cupo al crear — siempre decrementar)
  await ClassSession.findByIdAndUpdate(enrollment.sessionId._id, {
    $inc: { enrolledCount: -1 },
  });

  // Re-abrir la sesión si estaba llena
  const session = await ClassSession.findById(enrollment.sessionId._id);
  if (session?.status === "full" && session.enrolledCount < session.capacity) {
    session.status = "open";
    await session.save();
  }

  const org = await Organization.findById(enrollment.organizationId);
  await sendEnrollmentWhatsApp(
    "classEnrollmentCancelled",
    enrollment.organizationId,
    enrollment,
    enrollment.sessionId,
    enrollment.classId,
    org
  );

  return enrollment;
}

// ══════════════════════════════════════════════════════
// CONSULTAS
// ══════════════════════════════════════════════════════

async function getSessionEnrollments(sessionId, { status } = {}) {
  const filter = { sessionId };
  if (status) filter.status = status;
  return Enrollment.find(filter)
    .populate("clientId", "names phone")
    .sort({ createdAt: 1 });
}

async function getOrganizationEnrollments(organizationId, { status, sessionId, classId, from, to, page = 1, limit = 50 } = {}) {
  const filter = { organizationId };
  if (status) filter.status = status;
  if (sessionId) filter.sessionId = sessionId;
  if (classId) filter.classId = classId;

  if (from || to) {
    // Filtrar por fecha de la sesión requiere lookup; usamos createdAt como proxy
    // o dejamos que el controller filtre por sesión
  }

  const skip = (page - 1) * limit;
  const [enrollments, total] = await Promise.all([
    Enrollment.find(filter)
      .populate("sessionId", "startDate endDate status")
      .populate("classId", "name")
      .populate("clientId", "names phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Enrollment.countDocuments(filter),
  ]);

  return { enrollments, total, page, limit };
}

async function updateAttendanceStatus(enrollmentId, status) {
  const allowed = ["attended", "no_show"];
  if (!allowed.includes(status)) {
    throw new Error(`Estado inválido. Use: ${allowed.join(", ")}`);
  }
  const enrollment = await Enrollment.findByIdAndUpdate(
    enrollmentId,
    { status },
    { new: true }
  );
  if (!enrollment) throw new Error("Inscripción no encontrada");
  return enrollment;
}

async function addPayment(enrollmentId, paymentData) {
  const enrollment = await Enrollment.findById(enrollmentId);
  if (!enrollment) throw new Error("Inscripción no encontrada");
  enrollment.payments.push(paymentData);
  return enrollment.save();
}

export default {
  createPublicEnrollments,
  adminCreateEnrollments,
  approveEnrollment,
  cancelEnrollment,
  getSessionEnrollments,
  getOrganizationEnrollments,
  updateAttendanceStatus,
  addPayment,
  computeDiscountPercent,
  computeTotalPrice,
};
