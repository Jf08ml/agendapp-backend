// src/services/enrollmentService.js
import crypto from "crypto";
import { Types } from "mongoose";
import Enrollment from "../models/enrollmentModel.js";
import ClassSession from "../models/classSessionModel.js";
import Class from "../models/classModel.js";
import Client from "../models/clientModel.js";
import Organization from "../models/organizationModel.js";
import WhatsappTemplate from "../models/whatsappTemplateModel.js";
import { normalizePhoneNumber } from "../utils/phoneUtils.js";
import { generateClassCancellationLink } from "../utils/cancellationUtils.js";
import whatsappService from "./sendWhatsappService.js";
import packageService from "./packageService.js";
import whatsappTemplates from "../utils/whatsappTemplates.js";
import moment from "moment-timezone";
import notificationService from "./notificationService.js";
import subscriptionService from "./subscriptionService.js";
import membershipService from "./membershipService.js";

/**
 * Lanza un error si el plan de la organización no incluye el módulo de clases.
 */
async function assertClassesModule(organizationId) {
  const limits = await membershipService.getPlanLimits(organizationId);
  if (!limits?.classesModule) {
    throw new Error("Las reservas de clases no están disponibles en este momento.");
  }
}

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
      cancelLink: enrollment.cancellationLink || "",
      cancelBlock: enrollment.cancellationLink
        ? `\n❌ Si necesitas cancelar tu inscripción, hazlo aquí:\n${enrollment.cancellationLink}\n`
        : "",
    };

    // Respetar el toggle de envío configurado por la organización
    const templateDoc = await WhatsappTemplate.findOne({ organizationId });
    if (templateDoc?.enabledTypes?.[templateType] === false) {
      return;
    }

    // Pre-renderizar el texto (sirve como fallback para Meta y como mensaje Baileys)
    const fallbackMessage = await whatsappTemplates.getRenderedTemplate(
      organizationId,
      templateType,
      templateData
    );
    if (!fallbackMessage) return;

    // Ruta unificada: Meta (plantilla aprobada → Baileys coexistencia → texto libre)
    // o Baileys directo, según la configuración de la organización.
    await whatsappService.sendNotification(
      organizationId,
      phone,
      templateType,
      templateData,
      { fallbackMessage }
    );
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
async function createPublicEnrollments({ organizationId, sessionId, attendee, companion, notes, clientPackageId }) {
  const numPeople = companion ? 2 : 1;

  // 0. Verificar que el plan incluya el módulo de clases
  await assertClassesModule(organizationId);

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
  for (let i = 0; i < enrollmentsData.length; i++) {
    const { attendeeData, client } = enrollmentsData[i];
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
        phone_e164: normalized?.phone_e164 || attendeeData.phone,
        phone_country: attendeeData.phone_country || null,
        email: attendeeData.email || null,
      },
      pricePerPerson: classDoc.pricePerPerson,
      discountPercent,
      totalPrice,
      status: initialStatus,
      approvalMode,
      cancelTokenHash: hash,
      cancellationLink: generateClassCancellationLink(token, org),
      notes: notes || "",
    });

    await enrollment.save();

    // 📦 Cada persona usa SU PROPIO paquete:
    //    - Titular (i===0): el paquete indicado en la reserva.
    //    - Acompañante: su propio paquete activo para la clase, si tiene.
    let pkgToUse = null;
    if (i === 0) {
      pkgToUse = clientPackageId || null;
    } else if (client?._id) {
      const ownPkgs = await packageService.getActivePackagesForClass(client._id, classDoc._id, organizationId);
      pkgToUse = ownPkgs?.[0]?._id || null;
    }

    if (pkgToUse) {
      try {
        await packageService.consumeClassSession(pkgToUse, classDoc._id, enrollment._id);
        enrollment.clientPackageId = pkgToUse;
        enrollment.totalPrice = 0; // cubierta por el paquete
        await enrollment.save(); // pre-save recalcula paymentStatus = 'free'
      } catch {
        // sin créditos disponibles → se mantiene el precio normal
      }
    }

    // Guardar el token en el objeto para enviarlo en la respuesta (solo en creación)
    enrollment._cancelToken = token;
    created.push(enrollment);
  }

  // 8. Enviar WhatsApp de acuse de recibo.
  //    - Auto-aprobada → confirmación.
  //    - Aprobación manual → acuse "pendiente"; la confirmación se envía al aprobar.
  const ackTemplate = initialStatus === "confirmed"
    ? "classEnrollmentConfirmed"
    : "classEnrollmentPending";
  for (const enrollment of created) {
    await sendEnrollmentWhatsApp(ackTemplate, organizationId, enrollment, updatedSession, classDoc, org);
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
async function adminCreateEnrollments({ organizationId, sessionId, attendees, applyDiscount = true, notes, clientPackageId }) {
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
        phone_e164: normalized?.phone_e164 || attendeeData.phone,
        phone_country: attendeeData.phone_country || null,
        email: attendeeData.email || null,
      },
      pricePerPerson: classDoc.pricePerPerson,
      discountPercent: attendeeData.customPrice !== undefined ? 0 : discountPercent,
      totalPrice: finalPrice,
      status: "confirmed",
      approvalMode: "auto",
      cancelTokenHash: hash,
      cancellationLink: generateClassCancellationLink(token, org),
      notes: notes || "",
    });

    await enrollment.save();

    // 📦 Cubrir con un crédito de paquete si se indicó (y el asistente no tiene precio manual)
    if (clientPackageId && (attendeeData.customPrice === undefined || attendeeData.customPrice === null)) {
      try {
        await packageService.consumeClassSession(clientPackageId, classDoc._id, enrollment._id);
        enrollment.clientPackageId = clientPackageId;
        enrollment.totalPrice = 0;
        await enrollment.save();
      } catch {
        // sin créditos → se mantiene el precio normal
      }
    }

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

  // 📦 Reembolsar el crédito de paquete si la inscripción estaba cubierta por uno
  if (enrollment.clientPackageId) {
    try {
      await packageService.refundClassSession(
        enrollment.clientPackageId,
        enrollment.classId._id || enrollment.classId,
        enrollment._id
      );
    } catch (e) {
      console.warn("[enrollmentService] No se pudo reembolsar crédito de paquete:", e?.message || e);
    }
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
// CANCELACIÓN PÚBLICA POR TOKEN
// ══════════════════════════════════════════════════════

/**
 * Resuelve la(s) inscripción(es) asociadas a un token de cancelación.
 * Devuelve también las del mismo grupo (titular + acompañante).
 */
async function findEnrollmentsByToken(token) {
  if (!token) throw new Error("Token requerido");
  const hash = crypto.createHash("sha256").update(token).digest("hex");

  const enrollment = await Enrollment.findOne({ cancelTokenHash: hash })
    .select("+cancelTokenHash")
    .populate("sessionId")
    .populate("classId");

  if (!enrollment) throw new Error("Enlace de cancelación inválido o expirado");

  // Si pertenece a un grupo, traer todas las del grupo
  const enrollments = enrollment.groupId
    ? await Enrollment.find({ groupId: enrollment.groupId })
        .populate("sessionId")
        .populate("classId")
    : [enrollment];

  return enrollments;
}

/**
 * Vista pública (sin datos sensibles) de la(s) inscripción(es) del token.
 */
async function getEnrollmentInfoByToken(token) {
  const enrollments = await findEnrollmentsByToken(token);
  const org = await Organization.findById(enrollments[0].organizationId);

  return {
    organizationName: org?.name || "",
    timezone: org?.timezone || "America/Bogota",
    isGroup: enrollments.length > 1,
    enrollments: enrollments.map((e) => {
      const session = e.sessionId;
      const classDoc = e.classId;
      return {
        id: e._id,
        attendeeName: e.attendee?.name,
        className: classDoc?.name || "",
        startDate: session?.startDate,
        endDate: session?.endDate,
        status: e.status,
        isCancelled: e.status === "cancelled",
        isPast: session?.startDate ? new Date(session.startDate) < new Date() : false,
        totalPrice: e.totalPrice,
      };
    }),
  };
}

/**
 * Cancela por token. Si no se pasan enrollmentIds, cancela todas las del grupo
 * que aún sean cancelables.
 */
async function cancelEnrollmentsByToken(token, enrollmentIds) {
  const enrollments = await findEnrollmentsByToken(token);

  const targets = enrollmentIds?.length
    ? enrollments.filter((e) => enrollmentIds.map(String).includes(String(e._id)))
    : enrollments;

  const cancelled = [];
  for (const e of targets) {
    if (e.status === "cancelled") continue;
    const session = e.sessionId;
    // No permitir cancelar clases ya iniciadas
    if (session?.startDate && new Date(session.startDate) < new Date()) continue;
    await cancelEnrollment(e._id, "customer");
    cancelled.push(e._id);
  }

  if (!cancelled.length) {
    throw new Error("No hay inscripciones que se puedan cancelar");
  }

  return { cancelled };
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

async function getOrganizationEnrollments(organizationId, { status, sessionId, classId, page = 1, limit = 50 } = {}) {
  const filter = { organizationId };
  if (status) filter.status = status;
  if (sessionId) filter.sessionId = sessionId;
  if (classId) filter.classId = classId;

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

// ══════════════════════════════════════════════════════
// INSCRIPCIÓN PAGABLE (pay-to-confirm con depósito MP)
// ══════════════════════════════════════════════════════

/**
 * Retiene el cupo y crea la(s) inscripción(es) en estado "pending_payment"
 * (sin WhatsApp ni notificación al admin todavía). El depósito se cobra aparte
 * (Mercado Pago) y la confirmación la dispara el webhook. Si el pago no se
 * completa, `releaseEnrollmentHold` libera el cupo.
 *
 * Devuelve { created, totalPriceSum, groupId, classDoc, session, org }.
 */
async function holdEnrollmentsForPayment({ organizationId, sessionId, attendee, companion, notes }) {
  const numPeople = companion ? 2 : 1;

  await assertClassesModule(organizationId);

  const session = await ClassSession.findById(sessionId).populate("classId");
  if (!session) throw new Error("Sesión no encontrada");
  if (session.status === "cancelled") throw new Error("Esta sesión fue cancelada");
  if (session.status === "completed") throw new Error("Esta sesión ya finalizó");
  if (session.organizationId.toString() !== organizationId.toString()) {
    throw new Error("La sesión no pertenece a esta organización");
  }

  const classDoc = session.classId;

  // Reservar cupos atómicamente (hold)
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
  if (updatedSession.enrolledCount >= updatedSession.capacity) {
    updatedSession.status = "full";
    await updatedSession.save();
  }

  const discountPercent = computeDiscountPercent(classDoc.groupDiscount, numPeople);
  const totalPricePerPerson = computeTotalPrice(classDoc.pricePerPerson, discountPercent);

  const org = await Organization.findById(organizationId);
  const approvalMode = org?.reservationPolicy?.autoApprove ? "auto" : "manual";

  // groupId SIEMPRE (referenciamos el grupo desde el Order, aunque sea 1 persona)
  const groupId = new Types.ObjectId();

  const attendeesData = [attendee];
  if (companion) attendeesData.push(companion);

  const created = [];
  for (const attendeeData of attendeesData) {
    const client = await findOrCreateClient(organizationId, attendeeData, org);
    const { token, hash } = generateToken();
    const normalized = normalizePhoneNumber(attendeeData.phone, attendeeData.phone_country || "CO");

    const enrollment = new Enrollment({
      sessionId,
      classId: classDoc._id,
      organizationId,
      groupId,
      clientId: client?._id || null,
      attendee: {
        name: attendeeData.name,
        phone: attendeeData.phone,
        phone_e164: normalized?.phone_e164 || attendeeData.phone,
        phone_country: attendeeData.phone_country || null,
        email: attendeeData.email || null,
      },
      pricePerPerson: classDoc.pricePerPerson,
      discountPercent,
      totalPrice: totalPricePerPerson,
      status: "pending_payment",
      approvalMode,
      cancelTokenHash: hash,
      cancellationLink: generateClassCancellationLink(token, org),
      notes: notes || "",
    });
    await enrollment.save();
    created.push(enrollment);
  }

  const totalPriceSum = created.reduce((sum, e) => sum + (e.totalPrice || 0), 0);

  return { created, totalPriceSum, groupId, classDoc, session: updatedSession, org };
}

/**
 * Confirma las inscripciones de un grupo tras recibir el pago del depósito
 * (llamado desde el webhook de MP). Cambia pending_payment → confirmed/pending
 * según el modo de aprobación, registra el pago del depósito y envía el WhatsApp
 * de acuse + notifica al admin. Idempotente: si no hay pending_payment, no hace nada.
 */
async function confirmPaidEnrollmentGroup(groupId, { depositAmount = 0 } = {}) {
  const enrollments = await Enrollment.find({ groupId, status: "pending_payment" })
    .populate("sessionId")
    .populate("classId");
  if (!enrollments.length) return [];

  const org = await Organization.findById(enrollments[0].organizationId);

  // El depósito se reparte equitativamente entre los asistentes del grupo.
  const share = enrollments.length ? depositAmount / enrollments.length : 0;

  const confirmed = [];
  for (const e of enrollments) {
    e.status = e.approvalMode === "auto" ? "confirmed" : "pending";
    if (share > 0) {
      e.payments.push({ amount: share, method: "card", note: "Depósito (Mercado Pago)" });
    }
    await e.save(); // pre-save recalcula paymentStatus

    const ackTemplate = e.status === "confirmed" ? "classEnrollmentConfirmed" : "classEnrollmentPending";
    await sendEnrollmentWhatsApp(ackTemplate, e.organizationId, e, e.sessionId, e.classId, org);
    confirmed.push(e);
  }

  // Notificar al admin (silencioso)
  try {
    const first = enrollments[0];
    const attendeeName = first.attendee?.name || "Un cliente";
    const className = first.classId?.name || "una clase";
    const isAuto = first.approvalMode === "auto";
    const title = isAuto ? "Nueva inscripción a clase" : "Nueva inscripción pendiente";
    const message = isAuto
      ? `${attendeeName} se inscribió en ${className} (depósito pagado)`
      : `${attendeeName} pagó el depósito para ${className}. Pendiente de aprobación.`;

    await notificationService.createNotification({
      title,
      message,
      organizationId: first.organizationId,
      type: "reservation",
      frontendRoute: "/gestionar-clases",
      status: "unread",
    });
    await subscriptionService.sendNotificationToUser(
      first.organizationId,
      JSON.stringify({ title, message, icon: org?.branding?.pwaIcon })
    );
  } catch (e) {
    console.warn("[enrollmentService] Error notificando al admin (pago clase):", e?.message || e);
  }

  return confirmed;
}

/**
 * Libera el hold de un grupo cuyo pago no se completó (llamado desde el cron de
 * expiración). Cancela las inscripciones en pending_payment y devuelve el cupo.
 */
async function releaseEnrollmentHold(groupId) {
  const enrollments = await Enrollment.find({ groupId, status: "pending_payment" });
  let released = 0;
  for (const e of enrollments) {
    e.status = "cancelled";
    e.cancelledBy = "customer";
    e.cancelledAt = new Date();
    await e.save();

    await ClassSession.findByIdAndUpdate(e.sessionId, { $inc: { enrolledCount: -1 } });
    const session = await ClassSession.findById(e.sessionId);
    if (session?.status === "full" && session.enrolledCount < session.capacity) {
      session.status = "open";
      await session.save();
    }
    released++;
  }
  return released;
}

// ══════════════════════════════════════════════════════
// RECORDATORIOS DE CLASES
// ══════════════════════════════════════════════════════

/**
 * Envía recordatorios de WhatsApp para las clases que comienzan dentro de la
 * ventana `hoursBefore` configurada por cada organización. Pensado para
 * ejecutarse periódicamente (cada 30 min) desde el cron.
 *
 * Mismo criterio que las citas: ventana de 1 hora centrada en (ahora + hoursBefore),
 * marcando `reminderSent` para no reenviar.
 */
async function sendClassReminders() {
  const organizations = await Organization.find({
    "reminderSettings.enabled": { $ne: false },
  });

  let totalSent = 0;

  for (const org of organizations) {
    try {
      // Plan debe incluir el módulo de clases
      const limits = await membershipService.getPlanLimits(org._id);
      if (!limits?.classesModule) continue;
      if (limits.autoReminders === false) continue;

      const timezone = org.timezone || "America/Bogota";
      const hoursBefore = org.reminderSettings?.hoursBefore ?? 24;

      // Ventana objetivo: (ahora + hoursBefore) redondeada a la hora
      const targetStart = moment.tz(timezone).add(hoursBefore, "hours").startOf("hour").toDate();
      const targetEnd = moment.tz(timezone).add(hoursBefore, "hours").endOf("hour").toDate();

      // 1. Sesiones activas en la ventana
      const sessions = await ClassSession.find({
        organizationId: org._id,
        status: { $in: ["open", "full"] },
        startDate: { $gte: targetStart, $lt: targetEnd },
      }).populate("classId");

      if (!sessions.length) continue;

      const sessionMap = new Map(sessions.map((s) => [s._id.toString(), s]));

      // 2. Inscripciones confirmadas de esas sesiones, sin recordatorio enviado
      const enrollments = await Enrollment.find({
        sessionId: { $in: sessions.map((s) => s._id) },
        status: "confirmed",
        reminderSent: { $ne: true },
      });

      for (const enrollment of enrollments) {
        const session = sessionMap.get(enrollment.sessionId.toString());
        if (!session) continue;

        await sendEnrollmentWhatsApp(
          "classReminder",
          org._id,
          enrollment,
          session,
          session.classId,
          org
        );
        enrollment.reminderSent = true;
        await enrollment.save();
        totalSent++;
      }
    } catch (err) {
      console.error(`[sendClassReminders] Error en org ${org?._id}:`, err.message);
    }
  }

  if (totalSent) {
    console.log(`[sendClassReminders] ${totalSent} recordatorio(s) de clase enviado(s)`);
  }
  return { sent: totalSent };
}

export default {
  createPublicEnrollments,
  adminCreateEnrollments,
  approveEnrollment,
  cancelEnrollment,
  getEnrollmentInfoByToken,
  cancelEnrollmentsByToken,
  getSessionEnrollments,
  getOrganizationEnrollments,
  updateAttendanceStatus,
  addPayment,
  sendClassReminders,
  computeDiscountPercent,
  computeTotalPrice,
  holdEnrollmentsForPayment,
  confirmPaidEnrollmentGroup,
  releaseEnrollmentHold,
};
