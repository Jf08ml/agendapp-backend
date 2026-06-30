// cron/birthdayJob.js
import cron from "node-cron";
import moment from "moment-timezone";
import Membership from "../models/membershipModel.js";
import Client from "../models/clientModel.js";
import WhatsappTemplate from "../models/whatsappTemplateModel.js";
import whatsappService from "../services/sendWhatsappService.js";

/**
 * 🎂 Job de saludos de cumpleaños
 *
 * Corre una vez al día (9:00 AM hora Colombia) y, por cada organización con
 * membresía activa/trial y WhatsApp conectado, envía un saludo a los clientes
 * que cumplen años ese día (según la zona horaria de la organización).
 *
 * Reglas:
 * - El envío es OPT-IN: solo se envía si `enabledTypes.birthdayGreeting === true`
 *   (por defecto está desactivado).
 * - Se omiten los clientes sin `birthDate` o sin teléfono.
 * - Idempotencia anual: cada cliente recibe a lo sumo un saludo por año
 *   (`lastBirthdayGreetingAt`).
 * - El beneficio configurado por la org se inyecta en {{beneficio}}.
 */

const ACTIVE_STATUSES = ["active", "trial"];

/**
 * Determina si una org puede enviar WhatsApp (Meta o Baileys conectado).
 */
function orgCanSendWhatsapp(org) {
  if (!org) return false;
  if (org.waConnectionType === "meta") return true;
  return !!org.clientIdWhatsapp;
}

export async function runBirthdayGreetings() {
  console.log("🎂 [birthdayJob] Iniciando saludos de cumpleaños", new Date().toISOString());

  let totalSent = 0;
  let totalOrgs = 0;

  try {
    // Organizaciones con membresía activa/trial
    const memberships = await Membership.find({ status: { $in: ACTIVE_STATUSES } })
      .populate("organizationId")
      .lean();

    for (const membership of memberships) {
      const org = membership.organizationId;
      if (!org || !org._id) continue;
      if (!orgCanSendWhatsapp(org)) continue;

      // Config de plantillas de la org — opt-in explícito
      const templateDoc = await WhatsappTemplate.findOne({ organizationId: org._id });
      if (!templateDoc || templateDoc.enabledTypes?.birthdayGreeting !== true) continue;

      const tz = org.timezone || "America/Bogota";
      const today = moment.tz(tz);
      const month = today.month() + 1; // 1-12
      const day = today.date(); // 1-31
      const startOfYear = today.clone().startOf("year").toDate();

      // Clientes que cumplen años hoy (mes/día en UTC del birthDate almacenado),
      // que tengan teléfono y que no hayan recibido saludo este año.
      const clients = await Client.aggregate([
        {
          $match: {
            organizationId: org._id,
            birthDate: { $ne: null },
            phone_e164: { $nin: [null, ""] },
            $or: [
              { lastBirthdayGreetingAt: null },
              { lastBirthdayGreetingAt: { $lt: startOfYear } },
            ],
          },
        },
        {
          $addFields: {
            _bMonth: { $month: "$birthDate" },
            _bDay: { $dayOfMonth: "$birthDate" },
          },
        },
        { $match: { _bMonth: month, _bDay: day } },
        { $project: { name: 1, phone_e164: 1 } },
      ]);

      if (clients.length === 0) continue;

      totalOrgs += 1;
      const beneficio = (templateDoc.birthdayBenefit || "").trim();

      console.log(
        `🎂 [birthdayJob] ${org.name || org._id}: ${clients.length} cumpleañero(s) hoy`
      );

      for (const client of clients) {
        try {
          await whatsappService.sendNotification(
            org._id.toString(),
            client.phone_e164,
            "birthdayGreeting",
            {
              names: client.name,
              organization: org.name,
              beneficio,
            }
          );

          // Sellar idempotencia (atómico, solo si no se selló este año)
          await Client.updateOne(
            {
              _id: client._id,
              $or: [
                { lastBirthdayGreetingAt: null },
                { lastBirthdayGreetingAt: { $lt: startOfYear } },
              ],
            },
            { $set: { lastBirthdayGreetingAt: new Date() } }
          );

          totalSent += 1;
        } catch (err) {
          console.error(
            `🎂 [birthdayJob] Error enviando a ${client.name} (${org._id}):`,
            err?.message || err
          );
        }
      }
    }

    console.log(
      `🎂 [birthdayJob] Finalizado — ${totalSent} saludo(s) enviados en ${totalOrgs} organización(es)`
    );
  } catch (err) {
    console.error("🎂 [birthdayJob] Error general:", err?.message || err);
  }

  return { totalSent, totalOrgs };
}

const birthdayJob = cron.schedule(
  "0 9 * * *", // Todos los días a las 9:00 AM (hora Colombia)
  () => {
    runBirthdayGreetings();
  },
  {
    scheduled: false,
    timezone: "America/Bogota",
  }
);

export default birthdayJob;
