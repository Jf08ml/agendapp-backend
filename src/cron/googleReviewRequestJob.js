// cron/googleReviewRequestJob.js
//
// ⭐ Pedido de reseña en Google por WhatsApp después de la cita.
//
// Corre cada hora (minuto 40). Por cada organización con membresía activa/trial,
// WhatsApp conectado, perfil de Google configurado (Organization.googleBusiness
// .placeId) y `enabledTypes.googleReviewRequest` ACTIVADO por el administrador
// (apagado por defecto), busca las citas "attended" que terminaron hace entre
// REVIEW_DELAY_HOURS y REVIEW_MAX_AGE_HOURS y le escribe al cliente con el
// enlace para dejar su reseña. Reglas en utils/googleReviews.js:
//   - un mensaje por cliente (la cita más reciente de la visita);
//   - como máximo uno cada REVIEW_COOLDOWN_DAYS por cliente;
//   - solo entre 9:00 y 20:00 en la zona del negocio (si no, espera a la
//     siguiente corrida dentro de la ventana de 48 h).
// Va a todos los clientes atendidos por igual: Google prohíbe pedir reseña
// solo a quienes quedaron contentos ("review gating").
//
// Idempotencia: la cita queda resuelta (googleReviewRequestOutcome) ANTES de
// enviar, igual que el seguimiento. Sin reintentos: un pedido de reseña
// perdido cuesta poco y repetirlo molesta.

import cron from "node-cron";
import Membership from "../models/membershipModel.js";
import Appointment from "../models/appointmentModel.js";
import Client from "../models/clientModel.js";
import WhatsappTemplate from "../models/whatsappTemplateModel.js";
import whatsappService from "../services/sendWhatsappService.js";
import { waGetStatus } from "../services/waHttpService.js";
import { isWaReady } from "../services/waIntegrationService.js";
import {
  candidateWindow,
  googleReviewUrl,
  isWithinSendingHours,
  selectReviewCandidates,
} from "../utils/googleReviews.js";

const ACTIVE_STATUSES = ["active", "trial"];
const SEND_DELAY_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reviewRef = (apptId) => `review:${apptId}`;

function orgCanSendWhatsapp(org) {
  if (!org) return false;
  if (org.waConnectionType === "meta") return true;
  return !!org.clientIdWhatsapp;
}

async function markOutcome(apptIds, outcome) {
  if (!apptIds.length) return;
  await Appointment.updateMany(
    { _id: { $in: apptIds } },
    { $set: { googleReviewRequestOutcome: outcome, googleReviewRequestProcessedAt: new Date() } }
  );
}

/** Procesa una organización. Devuelve cuántos mensajes salieron. */
export async function processOrganization(org, { now = new Date() } = {}) {
  const reviewUrl = googleReviewUrl(org.googleBusiness?.placeId);
  if (!reviewUrl) return 0;

  const tz = org.timezone || "America/Bogota";
  if (!isWithinSendingHours(now, tz)) return 0;

  const { from, to } = candidateWindow(now);
  const appts = await Appointment.find({
    organizationId: org._id,
    status: "attended",
    // startDate acota por el índice {organizationId, startDate}.
    startDate: { $gte: new Date(from.getTime() - 24 * 3600 * 1000), $lte: to },
    endDate: { $gte: from, $lte: to },
    googleReviewRequestOutcome: { $exists: false },
  })
    .select("_id endDate client")
    .populate("client", "_id name phone_e164 googleReviewRequestedAt")
    .lean();
  if (!appts.length) return 0;

  const { toSend, skipped } = selectReviewCandidates(appts, { now });
  const byOutcome = new Map();
  for (const { appt, outcome } of skipped) {
    if (!byOutcome.has(outcome)) byOutcome.set(outcome, []);
    byOutcome.get(outcome).push(appt._id);
  }
  for (const [outcome, ids] of byOutcome) await markOutcome(ids, outcome);
  if (!toSend.length) return 0;

  // Baileys acepta el envío aunque la sesión esté caída: comprobar antes y,
  // si no está lista, esperar a la próxima corrida (siguen dentro de la ventana).
  if (org.waConnectionType !== "meta") {
    let ready = false;
    try {
      ready = isWaReady(await waGetStatus(org.clientIdWhatsapp));
    } catch (err) {
      console.warn(`⭐ [googleReviewJob] [${org.name}] No se pudo consultar WhatsApp: ${err?.message || err}`);
    }
    if (!ready) return 0;
  }

  let sent = 0;
  for (const appt of toSend) {
    const client = appt.client;
    await markOutcome([appt._id], "sent");
    await Client.updateOne({ _id: client._id }, { $set: { googleReviewRequestedAt: now } });
    try {
      const result = await whatsappService.sendNotification(
        org._id.toString(),
        client.phone_e164,
        "googleReviewRequest",
        { names: client.name, organization: org.name, reviewUrl },
        { externalRef: reviewRef(appt._id) }
      );
      if (result?.blocked) {
        // Plan sin WhatsApp: no cuenta como pedido hecho.
        await Appointment.updateOne({ _id: appt._id }, { $unset: { googleReviewRequestOutcome: "", googleReviewRequestProcessedAt: "" } });
        await Client.updateOne({ _id: client._id }, { $set: { googleReviewRequestedAt: client.googleReviewRequestedAt ?? null } });
        return sent;
      }
      sent += 1;
    } catch (err) {
      console.error(`⭐ [googleReviewJob] [${org.name}] Error enviando a ${client.phone_e164}:`, err?.message || err);
      await markOutcome([appt._id], err?.recipientIssue ? "skipped_no_whatsapp" : "failed");
      await Client.updateOne({ _id: client._id }, { $set: { googleReviewRequestedAt: client.googleReviewRequestedAt ?? null } });
    }
    await sleep(SEND_DELAY_MS);
  }
  return sent;
}

export async function runGoogleReviewRequests() {
  let totalSent = 0;
  try {
    const memberships = await Membership.find({ status: { $in: ACTIVE_STATUSES } })
      .populate("organizationId")
      .lean();

    for (const membership of memberships) {
      const org = membership.organizationId;
      if (!org?._id || !org.googleBusiness?.placeId || !orgCanSendWhatsapp(org)) continue;

      // Opt-in explícito del administrador (apagado por defecto).
      const templateDoc = await WhatsappTemplate.findOne({ organizationId: org._id }).select("enabledTypes").lean();
      if (templateDoc?.enabledTypes?.googleReviewRequest !== true) continue;

      try {
        totalSent += await processOrganization(org);
      } catch (err) {
        console.error(`⭐ [googleReviewJob] [${org.name}] Error:`, err?.message || err);
      }
    }
    if (totalSent > 0) console.log(`⭐ [googleReviewJob] ${totalSent} pedido(s) de reseña enviados.`);
  } catch (err) {
    console.error("⭐ [googleReviewJob] Error general:", err?.message || err);
  }
  return { totalSent };
}

const googleReviewRequestJob = cron.schedule(
  "40 * * * *",
  () => {
    runGoogleReviewRequests();
  },
  { scheduled: false, timezone: "America/Bogota" }
);

export default googleReviewRequestJob;
