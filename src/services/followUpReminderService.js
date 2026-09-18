// src/services/followUpReminderService.js
//
// Lógica de detección y clasificación del recordatorio de seguimiento entre
// servicios relacionados (ver Service.followUpServiceId/followUpDays).
// Funciones puras de lectura/clasificación, SIN efectos de escritura ni envío
// — las consumen tanto cron/followUpReminderJob.js (que además marca y envía)
// como los endpoints de solo lectura GET /clients/:id/follow-up-status (un cliente,
// clientController.getFollowUpStatus) y GET /clients/follow-ups (toda la organización,
// clientController.getOrgFollowUps), para no duplicar la lógica de "quién
// califica" en lugares que puedan divergir con el tiempo.

import moment from "moment-timezone";
import Service from "../models/serviceModel.js";
import Appointment from "../models/appointmentModel.js";
import Client from "../models/clientModel.js";

const CANCELLED_STATUSES = ["cancelled", "cancelled_by_customer", "cancelled_by_admin"];

// Si la cita gatillo superó followUpDays + este margen sin resolverse, se
// abandona sin enviar (nunca vuelve a ser candidata). Evita que activar el
// feature dispare sobre citas de hace meses/años la primera vez.
export const MAX_OVERDUE_DAYS = 30;

// Vista previa (qué haría el cron) según el resultado que tendría una cita gatillo "due".
const PREVIEW_BY_OUTCOME = {
  sent: { wouldSend: true, reason: "Se enviará en la próxima ejecución del recordatorio (10:00 a.m., hora de la organización)." },
  skipped_no_phone: { wouldSend: false, reason: "El cliente no tiene un teléfono registrado." },
  skipped_already_returned: {
    wouldSend: false,
    reason: "El cliente ya tiene una cita del servicio de seguimiento agendada o asistida.",
  },
};
const SUPERSEDED_PREVIEW = {
  wouldSend: false,
  reason: "Compite el mismo día con otra cita de seguimiento más reciente de este cliente; esta pierde prioridad.",
};

// Resultados finales de "no enviado" con motivo conocido. Los procesados SIN outcome son
// anteriores a que se guardara el motivo: no se sabe si salieron, así que no se listan como
// "no enviados" (en LZ NAILS, por ejemplo, son cientos y la mayoría probablemente sí se enviaron).
const NOT_SENT_OUTCOMES = ["skipped_already_returned", "skipped_no_phone", "skipped_superseded", "failed_max_retries"];

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

/** Cita ya procesada por el cron. Requiere `service` y `followUpReminderTargetServiceId` poblados. */
function buildProcessedItem(appt) {
  return {
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

  const processed = processedRaw.map(buildProcessedItem);

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
    pending.push(
      buildPendingItem({ appt, rule, followUpServiceById, projectedDate, windowState: "due", preview: PREVIEW_BY_OUTCOME[outcome] })
    );
  }

  for (const { appt, rule, projectedDate } of superseded) {
    pending.push(
      buildPendingItem({ appt, rule, followUpServiceById, projectedDate, windowState: "due", preview: SUPERSEDED_PREVIEW })
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

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildClientRef = (client) =>
  client && client.name
    ? { _id: String(client._id), name: client.name, phone: client.phone_e164 || client.phoneNumber || null }
    : null;

/**
 * Para muchas citas gatillo a la vez: "clienteId|servicioDeSeguimientoId" → fecha de la cita
 * más reciente (no cancelada) de ese cliente en ese servicio, en UNA consulta. Con esto se
 * decide "ya volvió" igual que resolveOutcome, sin una consulta por cita.
 */
async function buildLatestReturnIndex({ organizationId, candidates }) {
  if (!candidates.length) return new Map();

  const clientIds = [...new Set(candidates.map((c) => String(c.appt.client._id)))];
  const followUpServiceIds = [...new Set(candidates.map((c) => String(c.rule.followUpServiceId)))];
  const earliestStart = candidates.reduce(
    (min, c) => (new Date(c.appt.startDate) < min ? new Date(c.appt.startDate) : min),
    new Date(candidates[0].appt.startDate)
  );

  const later = await Appointment.find({
    organizationId,
    client: { $in: clientIds },
    service: { $in: followUpServiceIds },
    status: { $nin: CANCELLED_STATUSES },
    startDate: { $gt: earliestStart },
  })
    .select("client service startDate")
    .lean();

  const latest = new Map();
  for (const a of later) {
    const key = `${a.client}|${a.service}`;
    const current = latest.get(key);
    if (!current || a.startDate > current) latest.set(key, a.startDate);
  }
  return latest;
}

/** Equivalente en lote de resolveOutcome (mismos criterios, sin consultar por cita). */
function resolveOutcomeFromIndex({ appt, rule, latestReturnByKey }) {
  const client = appt.client;
  if (!client || !client.phone_e164) return "skipped_no_phone";
  const latest = latestReturnByKey.get(`${client._id}|${rule.followUpServiceId}`);
  return latest && latest > appt.startDate ? "skipped_already_returned" : "sent";
}

/**
 * Usado por GET /clients/follow-ups: lista general de TODA la organización, en 3 vistas:
 *  - "pending":  citas gatillo aún sin procesar cuyo seguimiento está por enviarse o toca hoy
 *                (mismo criterio que la pestaña por cliente). Las ya vencidas (pasaron
 *                followUpDays + MAX_OVERDUE_DAYS) no se listan: el cron ya no las evalúa y
 *                pueden ser cientos de citas históricas.
 *  - "sent":     procesadas con outcome "sent".
 *  - "not_sent": procesadas con un motivo conocido de no envío.
 * Filtros opcionales: serviceId (servicio gatillo) y search (nombre/teléfono del cliente).
 * `counts` respeta esos filtros y permite mostrar los totales de las 3 vistas a la vez;
 * `counts.legacy` = procesadas antes de que se guardara el motivo (no se listan en ninguna).
 */
export async function getOrgFollowUpOverview({
  organizationId,
  view = "pending",
  serviceId = null,
  search = "",
  page = 1,
  limit = 25,
  tz = "America/Bogota",
  referenceDate = new Date(),
}) {
  const { rules, followUpServiceById } = await getActiveRules(organizationId);

  const result = (extra = {}) => ({
    organizationHasRules: rules.length > 0,
    view,
    services: rules.map((r) => ({ _id: String(r._id), name: r.name })).sort((a, b) => a.name.localeCompare(b.name)),
    counts: { pending: 0, sent: 0, notSent: 0, legacy: 0 },
    page,
    limit,
    total: 0,
    pending: [],
    processed: [],
    ...extra,
  });

  if (!rules.length) return result();

  // Búsqueda por cliente: se resuelve una vez a ids y se aplica igual a las 3 vistas.
  const term = String(search || "").trim();
  let clientFilter = {};
  if (term) {
    const rx = new RegExp(escapeRegex(term), "i");
    const found = await Client.find({
      organizationId,
      $or: [{ name: rx }, { phone_e164: rx }, { phoneNumber: rx }],
    })
      .select("_id")
      .limit(2000)
      .lean();
    clientFilter = { client: { $in: found.map((c) => c._id) } };
  }

  const ref = moment.tz(referenceDate, tz);
  const rulesInScope = serviceId ? rules.filter((r) => String(r._id) === String(serviceId)) : rules;

  const pendingQuery = rulesInScope.length
    ? {
        organizationId,
        ...clientFilter,
        status: "attended",
        followUpReminderSent: { $ne: true },
        // Misma ventana que findDueCandidatesForRule: excluye las ya vencidas
        $or: rulesInScope.map((r) => ({
          service: r._id,
          startDate: { $gt: ref.clone().subtract(r.followUpDays + MAX_OVERDUE_DAYS, "days").toDate() },
        })),
      }
    : null;

  const processedBase = {
    organizationId,
    ...clientFilter,
    followUpReminderSent: true,
    ...(serviceId ? { service: serviceId } : {}),
  };
  const sentQuery = { ...processedBase, followUpReminderOutcome: "sent" };
  const notSentQuery = { ...processedBase, followUpReminderOutcome: { $in: NOT_SENT_OUTCOMES } };

  const [pendingCount, sentCount, notSentCount, legacyCount] = await Promise.all([
    pendingQuery ? Appointment.countDocuments(pendingQuery) : 0,
    Appointment.countDocuments(sentQuery),
    Appointment.countDocuments(notSentQuery),
    Appointment.countDocuments({ organizationId, followUpReminderSent: true, followUpReminderOutcome: null }),
  ]);
  const counts = { pending: pendingCount, sent: sentCount, notSent: notSentCount, legacy: legacyCount };

  // ── Procesadas (enviados / no enviados): paginación directa en Mongo ────
  if (view !== "pending") {
    const docs = await Appointment.find(view === "sent" ? sentQuery : notSentQuery)
      .populate("service", "name")
      .populate("followUpReminderTargetServiceId", "name")
      .populate("client", "name phone_e164 phoneNumber")
      .sort({ followUpReminderProcessedAt: -1, startDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return result({
      counts,
      total: view === "sent" ? sentCount : notSentCount,
      processed: docs.map((appt) => ({ ...buildProcessedItem(appt), client: buildClientRef(appt.client) })),
    });
  }

  // ── Programados: se clasifican en memoria (el conjunto vigente es acotado) ─
  if (!pendingQuery) return result({ counts });

  const pendingAppts = await Appointment.find(pendingQuery).select("service client startDate").lean();
  const clients = await Client.find({
    _id: { $in: [...new Set(pendingAppts.map((a) => String(a.client)).filter(Boolean))] },
  })
    .select("name phone_e164 phoneNumber")
    .lean();
  const clientById = new Map(clients.map((c) => [String(c._id), c]));
  const ruleByServiceId = new Map(rules.map((r) => [String(r._id), r]));

  const upcoming = [];
  const dueCandidates = [];
  for (const appt of pendingAppts) {
    const rule = ruleByServiceId.get(String(appt.service));
    const client = clientById.get(String(appt.client));
    if (!rule || !client) continue; // sin cliente no hay a quién escribirle ni qué mostrar

    const projectedDate = moment.tz(appt.startDate, tz).add(rule.followUpDays, "days");
    const candidate = { appt: { ...appt, client }, rule, projectedDate };

    if (ref.isBefore(projectedDate)) upcoming.push(candidate);
    else if (ref.isBefore(projectedDate.clone().add(MAX_OVERDUE_DAYS, "days"))) dueCandidates.push(candidate);
  }

  // Entre las "due" del mismo cliente, el mismo desempate que aplicaría el cron hoy.
  const { winners, superseded } = pickLatestPerClient(dueCandidates);
  const latestReturnByKey = await buildLatestReturnIndex({
    organizationId,
    candidates: [...upcoming, ...winners.values()],
  });

  const toItem = (candidate, windowState, preview) => ({
    ...buildPendingItem({
      appt: candidate.appt,
      rule: candidate.rule,
      followUpServiceById,
      projectedDate: candidate.projectedDate,
      windowState,
      preview,
    }),
    client: buildClientRef(candidate.appt.client),
  });

  const items = [];
  for (const candidate of upcoming) {
    // Un programado que ya no se enviaría (ya volvió / sin teléfono) se avisa desde ahora.
    const outcome = resolveOutcomeFromIndex({ ...candidate, latestReturnByKey });
    items.push(toItem(candidate, "upcoming", outcome === "sent" ? null : PREVIEW_BY_OUTCOME[outcome]));
  }
  for (const candidate of winners.values()) {
    const outcome = resolveOutcomeFromIndex({ ...candidate, latestReturnByKey });
    items.push(toItem(candidate, "due", PREVIEW_BY_OUTCOME[outcome]));
  }
  for (const candidate of superseded) {
    items.push(toItem(candidate, "due", SUPERSEDED_PREVIEW));
  }

  items.sort((a, b) => new Date(a.projectedDate) - new Date(b.projectedDate));

  return result({
    // El total real de esta vista es lo clasificado (excluye citas sin cliente/regla vigente)
    counts: { ...counts, pending: items.length },
    total: items.length,
    pending: items.slice((page - 1) * limit, page * limit),
  });
}
