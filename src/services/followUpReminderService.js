// src/services/followUpReminderService.js
//
// Lógica de detección y clasificación del recordatorio de seguimiento entre
// servicios relacionados (ver Service.followUpServiceId/followUpDays).
// Funciones puras de lectura/clasificación, SIN efectos de escritura ni envío
// — las consumen tanto cron/followUpReminderJob.js (que además marca y envía)
// como el endpoint de solo lectura GET /clients/:id/follow-up-status
// (clientController.getFollowUpStatus), para no duplicar la lógica de "quién
// califica" en dos lugares que puedan divergir con el tiempo.

import moment from "moment-timezone";
import Service from "../models/serviceModel.js";
import Appointment from "../models/appointmentModel.js";
import Client from "../models/clientModel.js";

const CANCELLED_STATUSES = ["cancelled", "cancelled_by_customer", "cancelled_by_admin"];

// Si la cita gatillo superó followUpDays + este margen sin resolverse, se
// abandona sin enviar (nunca vuelve a ser candidata). Evita que activar el
// feature dispare sobre citas de hace meses/años la primera vez.
export const MAX_OVERDUE_DAYS = 30;

/** Reglas activas de seguimiento de la organización (servicio destino ya resuelto). */
export async function getActiveRules(organizationId) {
  const rules = await Service.find({
    organizationId,
    followUpServiceId: { $ne: null },
    followUpDays: { $ne: null },
    isActive: true,
  }).lean();

  const followUpServiceIds = [...new Set(rules.map((r) => String(r.followUpServiceId)))];
  const followUpServices = followUpServiceIds.length
    ? await Service.find({ _id: { $in: followUpServiceIds } }).lean()
    : [];
  const followUpServiceById = new Map(followUpServices.map((s) => [String(s._id), s]));

  // Solo reglas cuyo servicio destino todavía existe.
  const validRules = rules.filter((r) => followUpServiceById.has(String(r.followUpServiceId)));

  return { rules: validRules, followUpServiceById };
}

/**
 * Resultado de evaluar UNA cita gatillo contra su regla:
 * "sent" (se enviaría/envía) | "skipped_no_phone" | "skipped_already_returned".
 * Requiere `appt.client` poblado con al menos `_id` y `phone_e164`.
 */
export async function resolveOutcome({ appt, rule, organizationId }) {
  const client = appt.client;
  if (!client || !client.phone_e164) return "skipped_no_phone";

  const alreadyFollowedUp = await Appointment.exists({
    organizationId,
    service: rule.followUpServiceId,
    client: client._id,
    startDate: { $gt: appt.startDate },
    status: { $nin: CANCELLED_STATUSES },
  });

  return alreadyFollowedUp ? "skipped_already_returned" : "sent";
}

/**
 * Entre varios candidatos `{ appt, rule }`, cada cliente se queda solo con la
 * cita gatillo más reciente (evita mandarle 2 WhatsApp el mismo día si
 * matchea varias reglas); el resto queda "superseded" sin evaluar.
 */
export function pickLatestPerClient(candidates) {
  const winners = new Map(); // clientId -> candidate
  for (const c of candidates) {
    const clientId = String(c.appt.client?._id || c.appt.client || "");
    if (!clientId) continue;
    const existing = winners.get(clientId);
    if (!existing || new Date(c.appt.startDate) > new Date(existing.appt.startDate)) {
      winners.set(clientId, c);
    }
  }
  const winnerApptIds = new Set([...winners.values()].map((c) => String(c.appt._id)));
  const superseded = candidates.filter((c) => !winnerApptIds.has(String(c.appt._id)));
  return { winners, superseded };
}

async function findDueCandidatesForRule({ organizationId, rule, tz, referenceDate }) {
  const ref = moment.tz(referenceDate, tz);
  const cutoff = ref.clone().subtract(rule.followUpDays, "days").toDate();
  const tooOldCutoff = ref.clone().subtract(rule.followUpDays + MAX_OVERDUE_DAYS, "days").toDate();

  const appts = await Appointment.find({
    organizationId,
    service: rule._id,
    status: "attended",
    followUpReminderSent: { $ne: true },
    startDate: { $lte: cutoff, $gt: tooOldCutoff },
  })
    .populate("client")
    .lean();

  return appts.map((appt) => ({ appt, rule }));
}

/**
 * Usado por el cron: TODO lo que califica HOY en la organización, ya
 * clasificado en los buckets que el cron necesita para marcar y enviar.
 */
export async function computeDueBatchForOrg({ organizationId, rules, tz, referenceDate }) {
  let allCandidates = [];
  for (const rule of rules) {
    const candidates = await findDueCandidatesForRule({ organizationId, rule, tz, referenceDate });
    allCandidates = allCandidates.concat(candidates);
  }

  const { winners, superseded } = pickLatestPerClient(allCandidates);

  const toSend = [];
  const skippedNoPhone = [];
  const skippedAlreadyReturned = [];

  for (const candidate of winners.values()) {
    const outcome = await resolveOutcome({ appt: candidate.appt, rule: candidate.rule, organizationId });
    if (outcome === "sent") toSend.push(candidate);
    else if (outcome === "skipped_no_phone") skippedNoPhone.push(candidate);
    else skippedAlreadyReturned.push(candidate);
  }

  return { toSend, skippedNoPhone, skippedAlreadyReturned, superseded };
}

function buildPendingItem({ appt, rule, followUpServiceById, projectedDate, windowState, preview }) {
  const followUpService = followUpServiceById.get(String(rule.followUpServiceId));
  return {
    appointmentId: String(appt._id),
    triggerService: { _id: String(rule._id), name: rule.name },
    followUpService: followUpService ? { _id: String(followUpService._id), name: followUpService.name } : null,
    followUpDays: rule.followUpDays,
    startDate: new Date(appt.startDate).toISOString(),
    projectedDate: projectedDate.toDate().toISOString(),
    windowState,
    preview,
  };
}

/**
 * Usado por GET /clients/:id/follow-up-status: para UN cliente, combina
 * citas gatillo pendientes (con fecha proyectada y, si ya están "due", una
 * vista previa de lo que haría el cron hoy) + ya procesadas (con el motivo
 * grabado por el cron, si se conoce).
 */
export async function getClientFollowUpOverview({ organizationId, clientId, tz = "America/Bogota", referenceDate = new Date() }) {
  const { rules, followUpServiceById } = await getActiveRules(organizationId);

  if (!rules.length) {
    return { organizationHasRules: false, pending: [], processed: [] };
  }

  const ruleByServiceId = new Map(rules.map((r) => [String(r._id), r]));
  const ruleServiceIds = rules.map((r) => r._id);

  // ── Procesadas (ya pasaron por el cron, con o sin motivo grabado) ──────
  const processedRaw = await Appointment.find({
    organizationId,
    client: clientId,
    followUpReminderSent: true,
  })
    .populate("service", "name")
    .populate("followUpReminderTargetServiceId", "name")
    .sort({ startDate: -1 })
    .lean();

  const processed = processedRaw.map((appt) => ({
    appointmentId: String(appt._id),
    triggerService: appt.service
      ? { _id: String(appt.service._id), name: appt.service.name }
      : { _id: String(appt.service), name: "Servicio eliminado" },
    followUpService: appt.followUpReminderTargetServiceId
      ? { _id: String(appt.followUpReminderTargetServiceId._id), name: appt.followUpReminderTargetServiceId.name }
      : null,
    startDate: new Date(appt.startDate).toISOString(),
    outcome: appt.followUpReminderOutcome || null,
    processedAt: appt.followUpReminderProcessedAt ? new Date(appt.followUpReminderProcessedAt).toISOString() : null,
  }));

  // ── Pendientes (attended, aún no procesadas, servicio con regla vigente) ─
  const pendingRaw = await Appointment.find({
    organizationId,
    client: clientId,
    service: { $in: ruleServiceIds },
    status: "attended",
    followUpReminderSent: { $ne: true },
  }).lean();

  const client = pendingRaw.length ? await Client.findById(clientId).select("name phone_e164").lean() : null;

  const ref = moment.tz(referenceDate, tz);
  const upcoming = [];
  const dueCandidates = [];
  const expired = [];

  for (const appt of pendingRaw) {
    const rule = ruleByServiceId.get(String(appt.service));
    if (!rule) continue; // defensivo — no debería pasar, service ∈ ruleServiceIds

    const projectedDate = moment.tz(appt.startDate, tz).add(rule.followUpDays, "days");
    const expiredDate = projectedDate.clone().add(MAX_OVERDUE_DAYS, "days");
    const candidate = { appt: { ...appt, client }, rule, projectedDate };

    if (ref.isBefore(projectedDate)) upcoming.push(candidate);
    else if (ref.isBefore(expiredDate)) dueCandidates.push(candidate);
    else expired.push(candidate);
  }

  // Entre las "due" de este mismo cliente, replicar exactamente el mismo
  // desempate que haría el cron si corriera ahora mismo.
  const { winners, superseded } = pickLatestPerClient(dueCandidates);

  const pending = [];

  for (const { appt, rule, projectedDate } of upcoming) {
    pending.push(buildPendingItem({ appt, rule, followUpServiceById, projectedDate, windowState: "upcoming", preview: null }));
  }

  for (const candidate of winners.values()) {
    const { appt, rule, projectedDate } = candidate;
    const outcome = await resolveOutcome({ appt, rule, organizationId });
    const preview =
      outcome === "sent"
        ? { wouldSend: true, reason: "Se enviará en la próxima ejecución del recordatorio (10:00 a.m., hora de la organización)." }
        : outcome === "skipped_no_phone"
        ? { wouldSend: false, reason: "El cliente no tiene un teléfono registrado." }
        : { wouldSend: false, reason: "El cliente ya tiene una cita del servicio de seguimiento agendada o asistida." };
    pending.push(buildPendingItem({ appt, rule, followUpServiceById, projectedDate, windowState: "due", preview }));
  }

  for (const { appt, rule, projectedDate } of superseded) {
    pending.push(
      buildPendingItem({
        appt,
        rule,
        followUpServiceById,
        projectedDate,
        windowState: "due",
        preview: {
          wouldSend: false,
          reason: "Compite el mismo día con otra cita de seguimiento más reciente de este cliente; esta pierde prioridad.",
        },
      })
    );
  }

  // "expired" se muestra igual (sin preview) para que el admin vea que quedó
  // atascada para siempre — el cron nunca la vuelve a evaluar.
  for (const { appt, rule, projectedDate } of expired) {
    pending.push(buildPendingItem({ appt, rule, followUpServiceById, projectedDate, windowState: "expired", preview: null }));
  }

  pending.sort((a, b) => new Date(a.projectedDate) - new Date(b.projectedDate));

  return { organizationHasRules: true, pending, processed };
}
