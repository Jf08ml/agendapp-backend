import Organization from "../models/organizationModel.js";
import { sendPlatformTemplate } from "./metaApiService.js";
import { logOutboundMessage } from "./platformInboxService.js";

/**
 * Retargeting por WhatsApp a dueños de organizaciones estancados en el funnel
 * de activación (ver Organization.onboardingMilestones). Cada plantilla se
 * envía una sola vez por org, marcada en Organization.retargeting.*SentAt.
 * El envío sale desde el número oficial de AgenditApp (META_PLATFORM_PHONE_NUMBER_ID).
 */

const SETUP_NUDGE_HOURS = 24;
const FIRST_APPOINTMENT_NUDGE_DAYS = 3;
const WHATSAPP_CONNECT_NUDGE_DAYS = 5;

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

// Representación legible del envío para el inbox de superadmin — no es el texto
// exacto aprobado por Meta (esa copia vive solo en Meta Business Manager), pero
// deja claro qué plantilla se disparó y con qué variables.
function templatePreview(templateName, params) {
  return `[Plantilla: ${templateName}] ${params.join(" · ")}`;
}

function logRetargetingSend(org, templateName, params) {
  logOutboundMessage({
    phone: org.phoneNumber,
    organizationId: org._id,
    body: templatePreview(templateName, params),
    source: "retargeting",
    templateName,
  }).catch((err) => console.error(`[retargeting] Error guardando envío en el inbox (${templateName}):`, err.message));
}

/** 1. Nunca completó la configuración inicial (~24h después del registro) */
export async function sendSetupNudges() {
  const candidates = await Organization.find({
    setupCompleted: false,
    "retargeting.setupNudgeSentAt": null,
    createdAt: { $lte: hoursAgo(SETUP_NUDGE_HOURS) },
  });

  let sent = 0;
  for (const org of candidates) {
    const link = orgLink(org, "/login-admin");
    if (!link) continue;

    try {
      const params = [ownerName(org), org.name, link];
      await sendPlatformTemplate(org.phoneNumber, "activa_tu_cuenta", params);
      logRetargetingSend(org, "activa_tu_cuenta", params);
      org.retargeting.setupNudgeSentAt = new Date();
      await org.save();
      sent++;
    } catch (err) {
      console.error(`[retargeting] Error enviando activa_tu_cuenta a ${org._id}:`, err.response?.data || err.message);
    }
  }
  return sent;
}

/** 2. Completó el setup pero nunca creó su primera cita (~3 días después) */
export async function sendFirstAppointmentNudges() {
  const candidates = await Organization.find({
    setupCompleted: true,
    "onboardingMilestones.firstAppointmentAt": null,
    "onboardingMilestones.setupCompletedAt": { $lte: daysAgo(FIRST_APPOINTMENT_NUDGE_DAYS) },
    "retargeting.firstAppointmentNudgeSentAt": null,
  });

  let sent = 0;
  for (const org of candidates) {
    const link = orgLink(org, "/gestionar-agenda");
    if (!link) continue;

    try {
      const params = [ownerName(org), org.name, link];
      await sendPlatformTemplate(org.phoneNumber, "agenda_tu_primera_cita", params);
      logRetargetingSend(org, "agenda_tu_primera_cita", params);
      org.retargeting.firstAppointmentNudgeSentAt = new Date();
      await org.save();
      sent++;
    } catch (err) {
      console.error(`[retargeting] Error enviando agenda_tu_primera_cita a ${org._id}:`, err.response?.data || err.message);
    }
  }
  return sent;
}

/** 3. Completó el setup pero nunca conectó WhatsApp (~5 días después) */
export async function sendWhatsappConnectNudges() {
  const candidates = await Organization.find({
    setupCompleted: true,
    "onboardingMilestones.whatsappConnectedAt": null,
    createdAt: { $lte: daysAgo(WHATSAPP_CONNECT_NUDGE_DAYS) },
    "retargeting.whatsappNudgeSentAt": null,
  });

  let sent = 0;
  for (const org of candidates) {
    const link = orgLink(org, "/gestionar-whatsapp");
    if (!link) continue;

    try {
      const params = [ownerName(org), org.name, link];
      await sendPlatformTemplate(org.phoneNumber, "conecta_tu_whatsapp", params);
      logRetargetingSend(org, "conecta_tu_whatsapp", params);
      org.retargeting.whatsappNudgeSentAt = new Date();
      await org.save();
      sent++;
    } catch (err) {
      console.error(`[retargeting] Error enviando conecta_tu_whatsapp a ${org._id}:`, err.response?.data || err.message);
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
    await sendPlatformTemplate(org.phoneNumber, "trial_por_vencer", params);
    logRetargetingSend(org, "trial_por_vencer", params);
  } catch (err) {
    console.error(`[retargeting] Error enviando trial_por_vencer a ${org._id}:`, err.response?.data || err.message);
  }
}
