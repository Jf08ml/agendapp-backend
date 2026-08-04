import Organization from "../models/organizationModel.js";
import { sendPlatformTemplate } from "./metaApiService.js";
import { logOutboundMessage } from "./platformInboxService.js";
import { renderPlatformTemplate } from "./platformTemplateCatalog.js";

/**
 * Retargeting por WhatsApp a dueños de organizaciones estancados en el funnel
 * de activación (ver Organization.onboardingMilestones). Cada plantilla se
 * envía una sola vez por org, marcada en Organization.retargeting.*SentAt.
 * El envío sale desde el número oficial de AgenditApp (META_PLATFORM_PHONE_NUMBER_ID).
 */

const SETUP_NUDGE_HOURS = 48;
const FIRST_APPOINTMENT_NUDGE_DAYS = 4;
const WHATSAPP_CONNECT_NUDGE_DAYS = 7;

// Tope de reintentos: si el envío falla (error duro de la API, no una entrega
// fallida que Meta reporta después vía webhook) esta cantidad de veces, se deja
// de reintentar — evita que un teléfono mal configurado reciba intentos todos
// los días para siempre. El org queda con SentAt: null y Attempts: MAX, lo que
// lo excluye de futuros candidatos (marcado para revisión manual vía query directa).
const MAX_NUDGE_ATTEMPTS = 3;

function hoursAgo(hours) {
  const date = new Date();
  date.setHours(date.getHours() - hours);
  return date;
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function orgLink(org, path) {
  return org.slug ? `https://${org.slug}.agenditapp.com${path}` : null;
}

function ownerName(org) {
  return org.ownerName || org.name;
}

// Texto tal como lo ve el cliente, reconstruido desde el catálogo de plantillas
// aprobadas (platformTemplateCatalog.js). Si la plantilla no está catalogada,
// cae de vuelta al preview genérico anterior.
function templatePreview(templateName, params) {
  return renderPlatformTemplate(templateName, params) || `[Plantilla: ${templateName}] ${params.join(" · ")}`;
}

function logRetargetingSend(org, templateName, params, metaMessageId) {
  logOutboundMessage({
    phone: org.phoneNumber,
    organizationId: org._id,
    body: templatePreview(templateName, params),
    source: "retargeting",
    templateName,
    metaMessageId,
  }).catch((err) => console.error(`[retargeting] Error guardando envío en el inbox (${templateName}):`, err.message));
}

/** 1. Nunca completó la configuración inicial (~48h después del registro) */
export async function sendSetupNudges() {
  const candidates = await Organization.find({
    setupCompleted: false,
    "retargeting.setupNudgeSentAt": null,
    "retargeting.setupNudgeAttempts": { $lt: MAX_NUDGE_ATTEMPTS },
    createdAt: { $lte: hoursAgo(SETUP_NUDGE_HOURS) },
  });

  let sent = 0;
  for (const org of candidates) {
    const link = orgLink(org, "/login-admin");
    if (!link) continue;

    // Reclamo atómico antes de enviar: si otro proceso (ej. otra instancia
    // del backend corriendo el mismo cron) ya marcó este envío entre el
    // find() de arriba y este punto, claimed viene null y no se envía —
    // evita duplicados por condición de carrera. El $inc de Attempts cuenta
    // este intento independientemente de si el envío termina fallando.
    const claimed = await Organization.findOneAndUpdate(
      { _id: org._id, "retargeting.setupNudgeSentAt": null, "retargeting.setupNudgeAttempts": { $lt: MAX_NUDGE_ATTEMPTS } },
      { $set: { "retargeting.setupNudgeSentAt": new Date() }, $inc: { "retargeting.setupNudgeAttempts": 1 } }
    );
    if (!claimed) continue;

    try {
      const params = [ownerName(org), org.name, link];
      const { messageId } = await sendPlatformTemplate(org.phoneNumber, "activa_tu_cuenta", params);
      logRetargetingSend(org, "activa_tu_cuenta", params, messageId);
      sent++;
    } catch (err) {
      console.error(`[retargeting] Error enviando activa_tu_cuenta a ${org._id}:`, err.response?.data || err.message);
      // El envío falló: liberar el reclamo para reintentar en la próxima corrida
      // (Attempts ya quedó incrementado — al llegar a MAX_NUDGE_ATTEMPTS deja de
      // ser candidato y queda marcado para revisión manual).
      const attemptsSoFar = (claimed.retargeting?.setupNudgeAttempts || 0) + 1;
      if (attemptsSoFar >= MAX_NUDGE_ATTEMPTS) {
        console.error(`[retargeting] activa_tu_cuenta: ${org._id} alcanzó el máximo de intentos (${MAX_NUDGE_ATTEMPTS}) — requiere revisión manual del teléfono.`);
      }
      await Organization.updateOne({ _id: org._id }, { $set: { "retargeting.setupNudgeSentAt": null } });
    }
  }
  return sent;
}

/** 2. Completó el setup pero nunca creó su primera cita (~4 días después) */
export async function sendFirstAppointmentNudges() {
  const candidates = await Organization.find({
    setupCompleted: true,
    "onboardingMilestones.firstAppointmentAt": null,
    "onboardingMilestones.setupCompletedAt": { $lte: daysAgo(FIRST_APPOINTMENT_NUDGE_DAYS) },
    "retargeting.firstAppointmentNudgeSentAt": null,
    "retargeting.firstAppointmentNudgeAttempts": { $lt: MAX_NUDGE_ATTEMPTS },
  });

  let sent = 0;
  for (const org of candidates) {
    const link = orgLink(org, "/gestionar-agenda");
    if (!link) continue;

    const claimed = await Organization.findOneAndUpdate(
      { _id: org._id, "retargeting.firstAppointmentNudgeSentAt": null, "retargeting.firstAppointmentNudgeAttempts": { $lt: MAX_NUDGE_ATTEMPTS } },
      { $set: { "retargeting.firstAppointmentNudgeSentAt": new Date() }, $inc: { "retargeting.firstAppointmentNudgeAttempts": 1 } }
    );
    if (!claimed) continue;

    try {
      const params = [ownerName(org), org.name, link];
      const { messageId } = await sendPlatformTemplate(org.phoneNumber, "agenda_tu_primera_cita", params);
      logRetargetingSend(org, "agenda_tu_primera_cita", params, messageId);
      sent++;
    } catch (err) {
      console.error(`[retargeting] Error enviando agenda_tu_primera_cita a ${org._id}:`, err.response?.data || err.message);
      const attemptsSoFar = (claimed.retargeting?.firstAppointmentNudgeAttempts || 0) + 1;
      if (attemptsSoFar >= MAX_NUDGE_ATTEMPTS) {
        console.error(`[retargeting] agenda_tu_primera_cita: ${org._id} alcanzó el máximo de intentos (${MAX_NUDGE_ATTEMPTS}) — requiere revisión manual del teléfono.`);
      }
      await Organization.updateOne({ _id: org._id }, { $set: { "retargeting.firstAppointmentNudgeSentAt": null } });
    }
  }
  return sent;
}

/** 3. Completó el setup pero nunca conectó WhatsApp (~7 días después) */
export async function sendWhatsappConnectNudges() {
  const candidates = await Organization.find({
    setupCompleted: true,
    "onboardingMilestones.whatsappConnectedAt": null,
    createdAt: { $lte: daysAgo(WHATSAPP_CONNECT_NUDGE_DAYS) },
    "retargeting.whatsappNudgeSentAt": null,
    "retargeting.whatsappNudgeAttempts": { $lt: MAX_NUDGE_ATTEMPTS },
  });

  let sent = 0;
  for (const org of candidates) {
    const link = orgLink(org, "/gestionar-whatsapp");
    if (!link) continue;

    const claimed = await Organization.findOneAndUpdate(
      { _id: org._id, "retargeting.whatsappNudgeSentAt": null, "retargeting.whatsappNudgeAttempts": { $lt: MAX_NUDGE_ATTEMPTS } },
      { $set: { "retargeting.whatsappNudgeSentAt": new Date() }, $inc: { "retargeting.whatsappNudgeAttempts": 1 } }
    );
    if (!claimed) continue;

    try {
      const params = [ownerName(org), org.name, link];
      const { messageId } = await sendPlatformTemplate(org.phoneNumber, "conecta_tu_whatsapp", params);
      logRetargetingSend(org, "conecta_tu_whatsapp", params, messageId);
      sent++;
    } catch (err) {
      console.error(`[retargeting] Error enviando conecta_tu_whatsapp a ${org._id}:`, err.response?.data || err.message);
      const attemptsSoFar = (claimed.retargeting?.whatsappNudgeAttempts || 0) + 1;
      if (attemptsSoFar >= MAX_NUDGE_ATTEMPTS) {
        console.error(`[retargeting] conecta_tu_whatsapp: ${org._id} alcanzó el máximo de intentos (${MAX_NUDGE_ATTEMPTS}) — requiere revisión manual del teléfono.`);
      }
      await Organization.updateOne({ _id: org._id }, { $set: { "retargeting.whatsappNudgeSentAt": null } });
    }
  }
  return sent;
}

/**
 * 4. Trial por vencer sin convertir a pago.
 * Llamado desde membershipCheckJob en el mismo punto donde ya se marca
 * notifications.threeDaysSent/oneDaySent — reusa esa idempotencia, por eso
 * no necesita su propio flag en Organization.retargeting.
 * @param {import("../models/membershipModel.js").default} membership - populado con organizationId
 * @param {number} daysLeft
 */
export async function sendTrialEndingNudge(membership, daysLeft) {
  const org = membership.organizationId;
  if (!org?.phoneNumber) return;

  const link = orgLink(org, "/my-membership");
  if (!link) return;

  try {
    const params = [ownerName(org), org.name, String(daysLeft), link];
    const { messageId } = await sendPlatformTemplate(org.phoneNumber, "trial_por_vencer", params);
    logRetargetingSend(org, "trial_por_vencer", params, messageId);
  } catch (err) {
    console.error(`[retargeting] Error enviando trial_por_vencer a ${org._id}:`, err.response?.data || err.message);
  }
}
