// cron/followUpReminderJob.js
import cron from "node-cron";
import moment from "moment-timezone";
import Membership from "../models/membershipModel.js";
import Appointment from "../models/appointmentModel.js";
import WhatsappTemplate from "../models/whatsappTemplateModel.js";
import whatsappService from "../services/sendWhatsappService.js";
import whatsappTemplates from "../utils/whatsappTemplates.js";
import { waBulkSend, waBulkOptIn, waGetStatus } from "../services/waHttpService.js";
import { isWaReady } from "../services/waIntegrationService.js";
import { getActiveRules, computeDueBatchForOrg } from "../services/followUpReminderService.js";

/**
 * 🔁 Job de recordatorios de seguimiento entre servicios relacionados
 *
 * Corre una vez al día (10:00 AM hora Colombia) y, por cada organización con
 * membresía activa/trial, WhatsApp conectado y `enabledTypes.followUpReminder`
 * activo, revisa los servicios que tienen configurado un `followUpServiceId` +
 * `followUpDays` (ej: "Montura de pestañas" → "Retoque" a los 20 días).
 *
 * Para cada cliente cuya última cita "attended" del servicio gatillo ya superó
 * los N días configurados (y no más de MAX_OVERDUE_DAYS extra — evita disparar
 * sobre historial de hace meses/años la primera vez que se activa el feature),
 * y que NO tiene ninguna cita (pasada ni futura) del servicio de seguimiento
 * posterior a esa fecha, se envía un WhatsApp automático.
 *
 * Un cliente recibe COMO MÁXIMO un mensaje por corrida, aunque matchee varias
 * reglas distintas — se elige la cita gatillo más reciente entre todas las reglas.
 *
 * Envío: Meta manda uno por uno con una pausa fija; Baileys arma un solo
 * paquete y el microservicio distribuye el envío con delays aleatorios.
 *
 * Idempotencia (reescrita 2026-11-08, Oriana centro de estética): la cita se
 * marca como enviada ANTES de enviar, en los dos canales. Antes, con Baileys,
 * el job esperaba como máximo 60 s a que terminara el paquete, pero el
 * microservicio deja 6–15 s entre mensajes: todo paquete de más de ~4 mensajes
 * quedaba "sin confirmar", se contaba como fallido y se le reenviaba al
 * cliente al día siguiente — 3 días seguidos el mismo mensaje.
 *
 * Confirmación de entrega: cada mensaje lleva externalRef "followup:<citaId>",
 * así que el ack real de WhatsApp (Baileys) o el status de Meta queda en
 * `followUpReminderDeliveryStatus` (waAgentController.applyDeliveryStatus).
 * Solo se reintenta lo que tiene una señal clara de que no salió: un error al
 * enviar, o un ack "failed" (que se revisa al inicio de la corrida siguiente).
 * Sin ack se da por enviado: reenviar a ciegas es lo que molestaba al cliente,
 * y perder un seguimiento cuesta poco.
 */

const ACTIVE_STATUSES = ["active", "trial"];

// Pausa entre envíos individuales (solo canal Meta, uno por uno vía Graph API).
const SEND_DELAY_MS = 200;

// Tope de intentos fallidos antes de dejar de reintentarle a un cliente.
// WhatsApp puede tratar cada intento a un contacto restringido como un nuevo
// "reach out" que empeora la restricción (ver error 463 de Baileys). Al llegar
// al tope, el candidato pasa a "failed_max_retries" (visible en Seguimientos).
const MAX_FOLLOWUP_RETRY_ATTEMPTS = 3;

const DELIVERY_FIELDS_UNSET = {
  followUpReminderDeliveryStatus: "",
  followUpReminderDeliveryUpdatedAt: "",
  followUpReminderDeliveryError: "",
};

function orgCanSendWhatsapp(org) {
  if (!org) return false;
  if (org.waConnectionType === "meta") return true;
  return !!org.clientIdWhatsapp;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const followUpRef = (apptId) => `followup:${apptId}`;

/**
 * Marca un lote de candidatos como procesados, grabando el outcome + el
 * snapshot de la regla vigente (target service/days) — agrupado por regla
 * porque cada una puede tener un servicio/días de seguimiento distinto.
 */
async function markProcessed(candidates, outcome) {
  if (!candidates.length) return;

  const byRule = new Map();
  for (const c of candidates) {
    const key = String(c.rule._id);
    if (!byRule.has(key)) byRule.set(key, { rule: c.rule, apptIds: [] });
    byRule.get(key).apptIds.push(c.appt._id);
  }

  const processedAt = new Date();
  for (const { rule, apptIds } of byRule.values()) {
    await Appointment.updateMany(
      { _id: { $in: apptIds } },
      {
        $set: {
          followUpReminderSent: true,
          followUpReminderOutcome: outcome,
          followUpReminderProcessedAt: processedAt,
          followUpReminderTargetServiceId: rule.followUpServiceId,
          followUpReminderTargetDays: rule.followUpDays,
        },
        // Un reenvío no debe heredar el ack del intento anterior.
        $unset: DELIVERY_FIELDS_UNSET,
      }
    );
  }
}

/** Deshace la marca previa al envío, sin contar un intento (el mensaje no salió por una causa ajena al cliente). */
async function unmark(apptIds) {
  if (!apptIds.length) return;
  await Appointment.updateMany(
    { _id: { $in: apptIds } },
    {
      $set: { followUpReminderSent: false },
      $unset: {
        followUpReminderOutcome: "",
        followUpReminderProcessedAt: "",
        ...DELIVERY_FIELDS_UNSET,
      },
    }
  );
}

/**
 * Registra un intento fallido por cita. Bajo el tope, la cita vuelve a ser
 * candidata en la próxima corrida (followUpReminderSent = false); al llegar
 * al tope queda como "failed_max_retries" y no se reintenta más.
 */
async function registerFailedAttempts(apptIds) {
  if (!apptIds.length) return;

  const current = await Appointment.find({ _id: { $in: apptIds } })
    .select("followUpReminderFailCount")
    .lean();

  const gaveUp = [];
  const retry = [];
  for (const a of current) {
    if ((a.followUpReminderFailCount || 0) + 1 >= MAX_FOLLOWUP_RETRY_ATTEMPTS) gaveUp.push(a._id);
    else retry.push(a._id);
  }

  if (retry.length) {
    await unmark(retry);
  }
  if (gaveUp.length) {
    // Se conserva el ack/error del último intento para poder diagnosticarlo.
    await Appointment.updateMany(
      { _id: { $in: gaveUp } },
      { $set: { followUpReminderSent: true, followUpReminderOutcome: "failed_max_retries", followUpReminderProcessedAt: new Date() } }
    );
  }
  await Appointment.updateMany({ _id: { $in: apptIds } }, { $inc: { followUpReminderFailCount: 1 } });
}

/**
 * Seguimientos que WhatsApp/Meta reportaron como no entregados ("failed")
 * después del envío: cuentan como intento fallido y, bajo el tope, vuelven a
 * ser candidatos en esta misma corrida (si siguen dentro de la ventana).
 */
async function requeueFailedDeliveries() {
  const failed = await Appointment.find({
    followUpReminderSent: true,
    followUpReminderOutcome: "sent",
    followUpReminderDeliveryStatus: "failed",
  })
    .select("_id")
    .lean();

  if (!failed.length) return 0;
  await registerFailedAttempts(failed.map((a) => a._id));
  console.log(`🔁 [followUpReminderJob] ${failed.length} seguimiento(s) con entrega fallida vuelven a la cola de reintento.`);
  return failed.length;
}

async function sendViaMeta({ org, dueToSend, toSend }) {
  let sent = 0;
  for (let i = 0; i < toSend.length; i++) {
    const item = toSend[i];
    const candidate = dueToSend[i];

    // Marca antes de enviar: si el proceso se corta a mitad de la tanda, al
    // reiniciar no se reenvía a quien ya recibió el mensaje.
    await markProcessed([candidate], "sent");
    try {
      const result = await whatsappService.sendNotification(org._id.toString(), item.phone, "followUpReminder", item.vars, {
        externalRef: followUpRef(item.apptId),
      });
      if (result?.blocked) {
        await unmark([item.apptId]);
      } else {
        sent += 1;
      }
    } catch (err) {
      console.error(`🔁 [followUpReminderJob] Error enviando a ${item.phone} (${org._id}):`, err?.message || err);
      if (err?.recipientIssue) {
        // El número no tiene WhatsApp: reintentar no sirve.
        await markProcessed([candidate], "skipped_no_whatsapp");
      } else {
        await registerFailedAttempts([item.apptId]);
      }
    }
    await sleep(SEND_DELAY_MS);
  }
  return sent;
}

async function sendViaBaileys({ org, templateDoc, tz, dueToSend, toSend }) {
  try {
    await waBulkOptIn(toSend.map((s) => s.phone));
  } catch (e) {
    console.warn(`🔁 [followUpReminderJob] [${org.name}] OptIn falló: ${e?.message || e}`);
  }

  // Marca antes de enviar: el microservicio reparte el paquete en varios
  // minutos y confirma cada mensaje por ack (externalRef), no al aceptar el lote.
  await markProcessed(dueToSend, "sent");

  try {
    const messageTpl = templateDoc?.followUpReminder || whatsappTemplates.getDefaultTemplate("followUpReminder");
    const result = await waBulkSend({
      clientId: org.clientIdWhatsapp,
      title: `Seguimiento ${moment.tz(tz).format("YYYY-MM-DD")} (${org.name})`,
      items: toSend.map((s) => ({ phone: s.phone, vars: s.vars, externalRef: followUpRef(s.apptId) })),
      messageTpl,
      dryRun: false,
    });
    console.log(
      `🔁 [followUpReminderJob] [${org.name}] Paquete aceptado: ${toSend.length} mensaje(s) (bulkId: ${result?.bulkId}); entrega por ack.`
    );
    return toSend.length;
  } catch (err) {
    console.error(`🔁 [followUpReminderJob] Error enviando paquete (${org._id}):`, err?.message || err);
    await registerFailedAttempts(toSend.map((s) => s.apptId));
    return 0;
  }
}

export async function runFollowUpReminders() {
  console.log("🔁 [followUpReminderJob] Iniciando recordatorios de seguimiento", new Date().toISOString());

  let totalSent = 0;
  let totalOrgs = 0;

  try {
    await requeueFailedDeliveries();

    const memberships = await Membership.find({ status: { $in: ACTIVE_STATUSES } })
      .populate("organizationId")
      .lean();

    for (const membership of memberships) {
      const org = membership.organizationId;
      if (!org || !org._id) continue;
      if (!orgCanSendWhatsapp(org)) continue;

      // Config de plantillas de la org — opt-in explícito
      const templateDoc = await WhatsappTemplate.findOne({ organizationId: org._id });
      if (!templateDoc || templateDoc.enabledTypes?.followUpReminder !== true) continue;

      // Reglas de seguimiento vigentes en la organización
      const { rules, followUpServiceById } = await getActiveRules(org._id);
      if (!rules.length) continue;

      const tz = org.timezone || "America/Bogota";

      const { toSend: dueToSend, skippedNoPhone, skippedAlreadyReturned, superseded } =
        await computeDueBatchForOrg({ organizationId: org._id, rules, tz, referenceDate: new Date() });

      // Resueltos sin enviar (perdió contra otra regla el mismo día / sin
      // teléfono / cliente ya volvió) — se marcan igual, para no volver a
      // evaluarlos mañana, cada uno con su motivo.
      await markProcessed(superseded, "skipped_superseded");
      await markProcessed(skippedNoPhone, "skipped_no_phone");
      await markProcessed(skippedAlreadyReturned, "skipped_already_returned");

      if (!dueToSend.length) continue;

      const isMeta = org.waConnectionType === "meta";

      // Baileys: el microservicio acepta el lote aunque la sesión esté caída —
      // sin este chequeo el mensaje se perdía y la cita quedaba "sent" (caso
      // luciazaratenails: sesión desconectada con reason 401).
      if (!isMeta) {
        let waReady = false;
        try {
          waReady = isWaReady(await waGetStatus(org.clientIdWhatsapp));
        } catch (err) {
          console.warn(`🔁 [followUpReminderJob] [${org.name}] No se pudo consultar estado de WhatsApp: ${err?.message || err}`);
        }
        if (!waReady) {
          console.warn(
            `🔁 [followUpReminderJob] [${org.name}] WhatsApp desconectado — se pospone el envío a ${dueToSend.length} cliente(s) para la próxima corrida.`
          );
          continue;
        }
      }

      const toSend = dueToSend.map(({ appt, rule }) => {
        const followUpService = followUpServiceById.get(String(rule.followUpServiceId));
        return {
          apptId: appt._id,
          phone: appt.client.phone_e164,
          vars: {
            names: appt.client.name,
            organization: org.name,
            service: followUpService.name,
            originalService: rule.name,
            days: String(rule.followUpDays),
          },
        };
      });

      const orgSent = isMeta
        ? await sendViaMeta({ org, dueToSend, toSend })
        : await sendViaBaileys({ org, templateDoc, tz, dueToSend, toSend });

      totalSent += orgSent;
      if (orgSent > 0) totalOrgs += 1;
    }

    console.log(
      `🔁 [followUpReminderJob] Finalizado — ${totalSent} recordatorio(s) enviados en ${totalOrgs} organización(es)`
    );
  } catch (err) {
    console.error("🔁 [followUpReminderJob] Error general:", err?.message || err);
  }

  return { totalSent, totalOrgs };
}

const followUpReminderJob = cron.schedule(
  "0 10 * * *", // Todos los días a las 10:00 AM (hora Colombia)
  () => {
    runFollowUpReminders();
  },
  {
    scheduled: false,
    timezone: "America/Bogota",
  }
);

export default followUpReminderJob;
