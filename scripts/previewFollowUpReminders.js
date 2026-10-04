/**
 * scripts/previewFollowUpReminders.js
 *
 * SOLO LECTURA — no envía WhatsApp ni escribe en la base de datos.
 *
 * Simula la lógica de cron/followUpReminderJob.js para UNA organización y
 * una fecha de referencia dada (por defecto: mañana), para poder responder
 * "¿a quién se le enviaría el recordatorio de seguimiento si el cron corriera
 * ese día?" sin esperar ni disparar el envío real.
 *
 * Uso:
 *   node -r @babel/register scripts/previewFollowUpReminders.js "LZ NAILS"
 *   node -r @babel/register scripts/previewFollowUpReminders.js "LZ NAILS" 2026-08-18
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import moment from "moment-timezone";

dotenv.config({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env.development",
});

const CANCELLED_STATUSES = ["cancelled", "cancelled_by_customer", "cancelled_by_admin"];
const MAX_OVERDUE_DAYS = 30;

async function run() {
  const orgNameArg = process.argv[2];
  const dateArg = process.argv[3]; // YYYY-MM-DD opcional

  if (!orgNameArg) {
    console.error("Uso: node -r @babel/register scripts/previewFollowUpReminders.js \"<nombre org>\" [YYYY-MM-DD]");
    process.exit(1);
  }

  await mongoose.connect(process.env.DB_URI);
  console.log("✓ Conectado a Mongo.\n");

  const Organization = (await import("../src/models/organizationModel.js")).default;
  const Membership = (await import("../src/models/membershipModel.js")).default;
  const Service = (await import("../src/models/serviceModel.js")).default;
  const Appointment = (await import("../src/models/appointmentModel.js")).default;
  const WhatsappTemplate = (await import("../src/models/whatsappTemplateModel.js")).default;

  const org = await Organization.findOne({ name: new RegExp(orgNameArg, "i") }).lean();
  if (!org) {
    console.error(`✖ No se encontró ninguna organización con nombre que matchee "${orgNameArg}"`);
    process.exit(1);
  }
  console.log(`Organización: ${org.name} (${org._id})`);

  const tz = org.timezone || "America/Bogota";
  const refMoment = dateArg ? moment.tz(dateArg, tz).startOf("day").add(10, "hours") : moment.tz(tz).add(1, "day");
  console.log(`Fecha de referencia simulada: ${refMoment.format("YYYY-MM-DD HH:mm")} (${tz})\n`);

  const membership = await Membership.findOne({ organizationId: org._id }).lean();
  const membershipOk = membership && ["active", "trial"].includes(membership.status);
  console.log(`Membresía: ${membership ? membership.status : "NINGUNA"} → ${membershipOk ? "OK" : "BLOQUEA el envío"}`);

  const canSendWa = org.waConnectionType === "meta" ? true : !!org.clientIdWhatsapp;
  console.log(
    `WhatsApp: waConnectionType=${org.waConnectionType || "baileys"}, clientIdWhatsapp=${
      org.clientIdWhatsapp ? "sí" : "no"
    } → ${canSendWa ? "OK" : "BLOQUEA el envío"}`
  );

  const templateDoc = await WhatsappTemplate.findOne({ organizationId: org._id }).lean();
  const toggleOn = templateDoc?.enabledTypes?.followUpReminder === true;
  console.log(`Toggle followUpReminder: ${toggleOn ? "ACTIVADO" : "DESACTIVADO"} → ${toggleOn ? "OK" : "BLOQUEA el envío"}\n`);

  const rules = await Service.find({
    organizationId: org._id,
    followUpServiceId: { $ne: null },
    followUpDays: { $ne: null },
    isActive: true,
  }).lean();

  if (!rules.length) {
    console.log("No hay servicios con regla de seguimiento configurada (followUpServiceId/followUpDays). Nada se enviaría.");
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`Reglas configuradas (${rules.length}):`);
  const followUpServiceIds = [...new Set(rules.map((r) => String(r.followUpServiceId)))];
  const followUpServices = await Service.find({ _id: { $in: followUpServiceIds } }).lean();
  const followUpServiceById = new Map(followUpServices.map((s) => [String(s._id), s]));
  for (const r of rules) {
    const fu = followUpServiceById.get(String(r.followUpServiceId));
    console.log(`  - "${r.name}" → "${fu ? fu.name : "??? (servicio de seguimiento no encontrado)"}" a los ${r.followUpDays} días`);
  }
  console.log("");

  const allCandidates = [];
  for (const rule of rules) {
    if (!followUpServiceById.has(String(rule.followUpServiceId))) continue;

    const cutoff = refMoment.clone().subtract(rule.followUpDays, "days").toDate();
    const tooOldCutoff = refMoment.clone().subtract(rule.followUpDays + MAX_OVERDUE_DAYS, "days").toDate();

    const candidates = await Appointment.find({
      organizationId: org._id,
      service: rule._id,
      status: "attended",
      followUpReminderSent: { $ne: true },
      startDate: { $lte: cutoff, $gt: tooOldCutoff },
    })
      .populate("client")
      .lean();

    for (const appt of candidates) {
      allCandidates.push({ appt, rule });
    }
  }

  if (!allCandidates.length) {
    console.log("Ningún cliente cae en la ventana de días para esa fecha. Nada se enviaría.");
    await mongoose.disconnect();
    process.exit(0);
  }

  const latestByClient = new Map();
  for (const c of allCandidates) {
    const clientId = String(c.appt.client?._id || c.appt.client || "");
    if (!clientId) continue;
    const existing = latestByClient.get(clientId);
    if (!existing || new Date(c.appt.startDate) > new Date(existing.appt.startDate)) {
      latestByClient.set(clientId, c);
    }
  }

  console.log(`Candidatos (cita gatillo dentro de la ventana): ${allCandidates.length}, clientes únicos: ${latestByClient.size}\n`);

  const wouldSend = [];
  const wouldSkip = [];

  for (const { appt, rule } of latestByClient.values()) {
    const client = appt.client;
    const followUpService = followUpServiceById.get(String(rule.followUpServiceId));

    if (!client || !client.phone_e164) {
      wouldSkip.push({ client, appt, rule, reason: "cliente sin teléfono" });
      continue;
    }

    const alreadyFollowedUp = await Appointment.exists({
      organizationId: org._id,
      service: rule.followUpServiceId,
      client: client._id,
      startDate: { $gt: appt.startDate },
      status: { $nin: CANCELLED_STATUSES },
    });

    if (alreadyFollowedUp) {
      wouldSkip.push({ client, appt, rule, reason: "ya tiene cita de seguimiento posterior (activa)" });
      continue;
    }

    wouldSend.push({ client, appt, rule, followUpService });
  }

  console.log(`=== SE ENVIARÍA A (${wouldSend.length}) ===`);
  for (const s of wouldSend) {
    console.log(
      `  ${s.client.name} (${s.client.phone_e164}) — cita "${s.rule.name}" el ${moment
        .tz(s.appt.startDate, tz)
        .format("YYYY-MM-DD")} → recordatorio de "${s.followUpService.name}"`
    );
  }

  console.log(`\n=== NO SE ENVIARÍA (${wouldSkip.length}) — ya resuelto o sin teléfono ===`);
  for (const s of wouldSkip) {
    console.log(
      `  ${s.client?.name || "(sin cliente)"} — cita "${s.rule.name}" el ${moment
        .tz(s.appt.startDate, tz)
        .format("YYYY-MM-DD")} → ${s.reason}`
    );
  }

  console.log(
    `\nRecordatorio: aunque haya candidatos arriba, el envío real requiere que las 3 condiciones de arriba (membresía / WhatsApp / toggle) estén en OK.`
  );

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("✖ Error:", err);
  process.exit(1);
});
