// cron/followUpReminderJob.js
import cron from "node-cron";
import moment from "moment-timezone";
import Membership from "../models/membershipModel.js";
import Service from "../models/serviceModel.js";
import Appointment from "../models/appointmentModel.js";
import WhatsappTemplate from "../models/whatsappTemplateModel.js";
import whatsappService from "../services/sendWhatsappService.js";
import whatsappTemplates from "../utils/whatsappTemplates.js";
import { waBulkSend, waBulkOptIn } from "../services/waHttpService.js";

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
const CANCELLED_STATUSES = ["cancelled", "cancelled_by_customer", "cancelled_by_admin"];

// Si la cita gatillo superó followUpDays + este margen sin resolverse, se
// abandona sin enviar (se marca igual, para no volver a evaluarla mañana).
// Evita que activar el feature dispare sobre citas de hace meses/años.
const MAX_OVERDUE_DAYS = 30;

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

      // Servicios con seguimiento configurado
      const rules = await Service.find({
        organizationId: org._id,
        followUpServiceId: { $ne: null },
        followUpDays: { $ne: null },
        isActive: true,
      }).lean();

      if (!rules.length) continue;

      const followUpServiceIds = [...new Set(rules.map((r) => String(r.followUpServiceId)))];
      const followUpServices = await Service.find({ _id: { $in: followUpServiceIds } }).lean();
      const followUpServiceById = new Map(followUpServices.map((s) => [String(s._id), s]));

      const tz = org.timezone || "America/Bogota";

      // Recolectar candidatos de TODAS las reglas antes de decidir qué enviar
      // — así, si un cliente matchea varias reglas (ej. distintos estilos de
      // pestañas), se evalúa una sola vez con su cita gatillo más reciente,
      // en vez de la primera regla que se procese por orden arbitrario.
      const allCandidates = [];
      for (const rule of rules) {
        if (!followUpServiceById.has(String(rule.followUpServiceId))) continue;

        const cutoff = moment.tz(tz).subtract(rule.followUpDays, "days").toDate();
        const tooOldCutoff = moment
          .tz(tz)
          .subtract(rule.followUpDays + MAX_OVERDUE_DAYS, "days")
          .toDate();

        const candidates = await Appointment.find({
          organizationId: org._id,
          service: rule._id,
          status: "attended",
          // $ne (no === false): las citas creadas antes de que este campo
          // existiera en el esquema no lo tienen guardado en absoluto, y un
          // filtro estricto `false` no matchea documentos donde el campo
          // está ausente — quedaban invisibles para este cron para siempre.
          followUpReminderSent: { $ne: true },
          startDate: { $lte: cutoff, $gt: tooOldCutoff },
        })
          .populate("client")
          .lean();

        for (const appt of candidates) {
          allCandidates.push({ appt, rule });
        }
      }

      if (!allCandidates.length) continue;

      // Más reciente por cliente, entre TODAS las reglas que matchearon.
      const latestByClient = new Map();
      for (const c of allCandidates) {
        const clientId = String(c.appt.client?._id || c.appt.client || "");
        if (!clientId) continue;
        const existing = latestByClient.get(clientId);
        if (!existing || new Date(c.appt.startDate) > new Date(existing.appt.startDate)) {
          latestByClient.set(clientId, c);
        }
      }

      // El resto (mismo cliente con citas más viejas, o sin client._id) se
      // marca resuelto sin enviar — no duplicar mensajes el mismo día.
      const chosenApptIds = new Set([...latestByClient.values()].map((c) => String(c.appt._id)));
      const staleIds = allCandidates
        .filter((c) => !chosenApptIds.has(String(c.appt._id)))
        .map((c) => c.appt._id);
      if (staleIds.length) {
        await Appointment.updateMany({ _id: { $in: staleIds } }, { $set: { followUpReminderSent: true } });
      }

      const toSend = [];
      const resolvedOnlyIds = [];

      for (const { appt, rule } of latestByClient.values()) {
        const client = appt.client;
        if (!client || !client.phone_e164) {
          resolvedOnlyIds.push(appt._id);
          continue;
        }

        // ¿Ya tiene una cita del servicio de seguimiento posterior a la gatillo?
        const alreadyFollowedUp = await Appointment.exists({
          organizationId: org._id,
          service: rule.followUpServiceId,
          client: client._id,
          startDate: { $gt: appt.startDate },
          status: { $nin: CANCELLED_STATUSES },
        });

        if (alreadyFollowedUp) {
          resolvedOnlyIds.push(appt._id);
          continue;
        }

        const followUpService = followUpServiceById.get(String(rule.followUpServiceId));
        toSend.push({
          apptId: appt._id,
          phone: client.phone_e164,
          vars: {
            names: client.name,
            organization: org.name,
            service: followUpService.name,
            originalService: rule.name,
            days: String(rule.followUpDays),
          },
        });
      }

      if (resolvedOnlyIds.length) {
        await Appointment.updateMany({ _id: { $in: resolvedOnlyIds } }, { $set: { followUpReminderSent: true } });
      }

      if (!toSend.length) continue;

      // Marcar ANTES de enviar — evita reenvíos si el proceso se interrumpe
      // a mitad de la tanda (mismo patrón que sendDailyReminders).
      await Appointment.updateMany(
        { _id: { $in: toSend.map((s) => s.apptId) } },
        { $set: { followUpReminderSent: true } }
      );

      let orgSent = 0;
      const isMeta = org.waConnectionType === "meta";

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
