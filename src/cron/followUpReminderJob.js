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
 * reglas distintas (ej. varios estilos de pestañas, cada uno con su propio
 * seguimiento) — se elige la cita gatillo más reciente entre todas las reglas.
 *
 * Envío: igual que sendDailyReminders (appointmentService.js) — Meta manda
 * uno por uno con una pausa fija; Baileys arma un solo paquete y el
 * microservicio externo distribuye el envío con delays aleatorios, evitando
 * ráfagas de decenas/cientos de mensajes en el mismo minuto.
 *
 * Idempotencia: se marca `followUpReminderSent` en la cita gatillo ANTES de
 * enviar (evita reenvíos si el proceso se interrumpe a mitad de una tanda),
 * igual que `reminderSent`.
 */

const ACTIVE_STATUSES = ["active", "trial"];

// Pausa entre envíos individuales (solo canal Meta, uno por uno vía Graph API).
const SEND_DELAY_MS = 200;

function orgCanSendWhatsapp(org) {
  if (!org) return false;
  if (org.waConnectionType === "meta") return true;
  return !!org.clientIdWhatsapp;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Marca un lote de candidatos como procesados, grabando el outcome + el
 * snapshot de la regla vigente (target service/days) — agrupado por regla
 * porque cada una puede tener un servicio/días de seguimiento distinto y un
 * único updateMany compartido les pisaría el snapshot entre sí.
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
      }
    );
  }
}

export async function runFollowUpReminders() {
  console.log("🔁 [followUpReminderJob] Iniciando recordatorios de seguimiento", new Date().toISOString());

  let totalSent = 0;
  let totalOrgs = 0;

  try {
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

      if (!dueToSend.length && !skippedNoPhone.length && !skippedAlreadyReturned.length && !superseded.length) {
        continue;
      }

      // Resueltos sin enviar (perdió contra otra regla el mismo día / sin
      // teléfono / cliente ya volvió) — se marcan igual, para no volver a
      // evaluarlos mañana, cada uno con su motivo.
      await markProcessed(superseded, "skipped_superseded");
      await markProcessed(skippedNoPhone, "skipped_no_phone");
      await markProcessed(skippedAlreadyReturned, "skipped_already_returned");

      if (!dueToSend.length) continue;

      const isMeta = org.waConnectionType === "meta";

      // Baileys: el microservicio externo acepta el lote (200 ok) aunque la
      // sesión esté caída — sin este chequeo el cron marcaba "sent" sin haber
      // entregado nada, y al ser idempotente nunca lo reintentaba (bug real
      // detectado en luciazaratenails: sesión desconectada con reason 401,
      // 14 citas marcadas "sent" sin ningún mensaje enviado).
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

      // Marcar ANTES de enviar — evita reenvíos si el proceso se interrumpe
      // a mitad de la tanda (mismo patrón que sendDailyReminders). Ahora solo
      // se llega aquí con la sesión Baileys confirmada como conectada (o vía Meta).
      await markProcessed(dueToSend, "sent");

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

      let orgSent = 0;

      if (isMeta) {
        for (const item of toSend) {
          try {
            await whatsappService.sendNotification(org._id.toString(), item.phone, "followUpReminder", item.vars);
            orgSent++;
          } catch (err) {
            console.error(
              `🔁 [followUpReminderJob] Error enviando a ${item.phone} (${org._id}):`,
              err?.message || err
            );
          }
          await sleep(SEND_DELAY_MS);
        }
      } else {
        // Baileys: un solo paquete — el microservicio externo distribuye el
        // envío con delays aleatorios (mismo mecanismo que sendDailyReminders).
        try {
          await waBulkOptIn(toSend.map((s) => s.phone));
        } catch (e) {
          console.warn(`🔁 [followUpReminderJob] [${org.name}] OptIn falló: ${e?.message || e}`);
        }

        try {
          const messageTpl = templateDoc?.followUpReminder || whatsappTemplates.getDefaultTemplate("followUpReminder");
          const result = await waBulkSend({
            clientId: org.clientIdWhatsapp,
            title: `Seguimiento ${moment.tz(tz).format("YYYY-MM-DD")} (${org.name})`,
            items: toSend.map((s) => ({ phone: s.phone, vars: s.vars })),
            messageTpl,
            dryRun: false,
          });
          orgSent = toSend.length;
          console.log(
            `🔁 [followUpReminderJob] [${org.name}] Paquete enviado: ${toSend.length} mensajes (bulkId: ${result.bulkId})`
          );
        } catch (err) {
          console.error(`🔁 [followUpReminderJob] Error enviando paquete (${org._id}):`, err?.message || err);
        }
      }

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
