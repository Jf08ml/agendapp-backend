// cron/followUpReminderJob.js
import cron from "node-cron";
import moment from "moment-timezone";
import Membership from "../models/membershipModel.js";
import Service from "../models/serviceModel.js";
import Appointment from "../models/appointmentModel.js";
import WhatsappTemplate from "../models/whatsappTemplateModel.js";
import whatsappService from "../services/sendWhatsappService.js";

/**
 * 🔁 Job de recordatorios de seguimiento entre servicios relacionados
 *
 * Corre una vez al día (10:00 AM hora Colombia) y, por cada organización con
 * membresía activa/trial, WhatsApp conectado y `enabledTypes.followUpReminder`
 * activo, revisa los servicios que tienen configurado un `followUpServiceId` +
 * `followUpDays` (ej: "Montura de pestañas" → "Retoque" a los 20 días).
 *
 * Para cada cliente cuya última cita "attended" del servicio gatillo ya superó
 * los N días configurados, y que NO tiene ninguna cita (pasada ni futura) del
 * servicio de seguimiento posterior a esa fecha, se envía un WhatsApp automático.
 *
 * Idempotencia: se marca `followUpReminderSent` en la cita gatillo tras enviar
 * (o al detectar que el seguimiento ya fue resuelto), igual que `reminderSent`.
 */

const ACTIVE_STATUSES = ["active", "trial"];
const CANCELLED_STATUSES = ["cancelled", "cancelled_by_customer", "cancelled_by_admin"];

function orgCanSendWhatsapp(org) {
  if (!org) return false;
  if (org.waConnectionType === "meta") return true;
  return !!org.clientIdWhatsapp;
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

      const tz = org.timezone || "America/Bogota";
      let orgSent = 0;

      for (const rule of rules) {
        const followUpService = await Service.findById(rule.followUpServiceId).lean();
        if (!followUpService) continue;

        const cutoff = moment.tz(tz).subtract(rule.followUpDays, "days").toDate();

        const candidates = await Appointment.find({
          organizationId: org._id,
          service: rule._id,
          status: "attended",
          followUpReminderSent: false,
          startDate: { $lte: cutoff },
        })
          .populate("client")
          .lean();

        if (!candidates.length) continue;

        // Un cliente puede tener varias citas gatillo vencidas: nos quedamos
        // solo con la más reciente para evaluar/enviar, y marcamos las demás
        // como resueltas (sin enviar) para no duplicar mensajes el mismo día.
        const latestByClient = new Map();
        for (const appt of candidates) {
          const clientId = String(appt.client?._id || appt.client || "");
          if (!clientId) continue;
          const existing = latestByClient.get(clientId);
          if (!existing || new Date(appt.startDate) > new Date(existing.startDate)) {
            latestByClient.set(clientId, appt);
          }
        }

        const latestIds = new Set([...latestByClient.values()].map((a) => String(a._id)));
        const staleIds = candidates
          .filter((a) => a.client?._id && !latestIds.has(String(a._id)))
          .map((a) => a._id);
        if (staleIds.length) {
          await Appointment.updateMany(
            { _id: { $in: staleIds } },
            { $set: { followUpReminderSent: true } }
          );
        }

        for (const appt of latestByClient.values()) {
          try {
            const client = appt.client;
            if (!client || !client.phone_e164) {
              await Appointment.updateOne(
                { _id: appt._id },
                { $set: { followUpReminderSent: true } }
              );
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
              await Appointment.updateOne(
                { _id: appt._id },
                { $set: { followUpReminderSent: true } }
              );
              continue;
            }

            await whatsappService.sendNotification(
              org._id.toString(),
              client.phone_e164,
              "followUpReminder",
              {
                names: client.name,
                organization: org.name,
                service: followUpService.name,
                originalService: rule.name,
                days: String(rule.followUpDays),
              }
            );

            await Appointment.updateOne(
              { _id: appt._id },
              { $set: { followUpReminderSent: true } }
            );

            orgSent += 1;
            totalSent += 1;
          } catch (err) {
            console.error(
              `🔁 [followUpReminderJob] Error con cita ${appt._id} (${org._id}):`,
              err?.message || err
            );
          }
        }
      }

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
