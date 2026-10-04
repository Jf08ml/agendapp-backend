/**
 * scripts/previewFollowUpRemindersTimeline.js
 *
 * SOLO LECTURA — no envía WhatsApp ni escribe en la base de datos.
 *
 * Simula día por día (en memoria) qué días futuros dispararía el cron de
 * cron/followUpReminderJob.js para una organización, replicando el mismo
 * orden cronológico que correría el cron real (una "marca de enviado" en
 * memoria por cada día simulado, para no repetir envíos ya cubiertos por
 * un día anterior de la simulación).
 *
 * Uso:
 *   node -r @babel/register scripts/previewFollowUpRemindersTimeline.js "LZ NAILS" [días a simular, default 60]
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
  const daysAhead = parseInt(process.argv[3], 10) || 60;

  if (!orgNameArg) {
    console.error(
      "Uso: node -r @babel/register scripts/previewFollowUpRemindersTimeline.js \"<nombre org>\" [días]"
    );
    process.exit(1);
  }

  await mongoose.connect(process.env.DB_URI);
  console.log("✓ Conectado a Mongo.\n");

  const Organization = (await import("../src/models/organizationModel.js")).default;
  const Service = (await import("../src/models/serviceModel.js")).default;
  await import("../src/models/clientModel.js"); // requerido por populate("client")
  const Appointment = (await import("../src/models/appointmentModel.js")).default;

  const org = await Organization.findOne({ name: new RegExp(orgNameArg, "i") }).lean();
  if (!org) {
    console.error(`✖ No se encontró ninguna organización con nombre que matchee "${orgNameArg}"`);
    process.exit(1);
  }
  console.log(`Organización: ${org.name} (${org._id})`);

  const tz = org.timezone || "America/Bogota";
  const today = moment.tz(tz).startOf("day");

  const rules = await Service.find({
    organizationId: org._id,
    followUpServiceId: { $ne: null },
    followUpDays: { $ne: null },
    isActive: true,
  }).lean();

  if (!rules.length) {
    console.log("No hay servicios con regla de seguimiento configurada. Nada se enviaría nunca.");
    await mongoose.disconnect();
    process.exit(0);
  }

  const followUpServiceIds = [...new Set(rules.map((r) => String(r.followUpServiceId)))];
  const followUpServices = await Service.find({ _id: { $in: followUpServiceIds } }).lean();
  const followUpServiceById = new Map(followUpServices.map((s) => [String(s._id), s]));

  console.log(`Reglas configuradas (${rules.length}):`);
  for (const r of rules) {
    const fu = followUpServiceById.get(String(r.followUpServiceId));
    console.log(`  - "${r.name}" → "${fu ? fu.name : "???"}" a los ${r.followUpDays} días`);
  }

  // Precargar TODAS las citas 'attended' de los servicios con regla, no marcadas como enviadas.
  const ruleServiceIds = rules.map((r) => r._id);
  const allAttended = await Appointment.find({
    organizationId: org._id,
    service: { $in: ruleServiceIds },
    status: "attended",
    followUpReminderSent: { $ne: true },
  })
    .populate("client")
    .lean();

  const ruleByServiceId = new Map(rules.map((r) => [String(r._id), r]));

  // "alreadyFollowedUp" no depende del día simulado (usa datos actuales de la
  // agenda, incluidas citas futuras ya reservadas) — se evalúa una sola vez.
  const alreadyFollowedUpCache = new Map(); // key: apptId -> bool
  for (const appt of allAttended) {
    const rule = ruleByServiceId.get(String(appt.service));
    if (!appt.client) {
      alreadyFollowedUpCache.set(String(appt._id), true); // sin cliente -> nunca se envía
      continue;
    }
    const exists = await Appointment.exists({
      organizationId: org._id,
      service: rule.followUpServiceId,
      client: appt.client._id,
      startDate: { $gt: appt.startDate },
      status: { $nin: CANCELLED_STATUSES },
    });
    alreadyFollowedUpCache.set(String(appt._id), !!exists);
  }

  const simulatedSent = new Set(); // apptIds "consumidos" en días previos de la simulación
  const results = []; // { date, client, rule, followUpService, apptStartDate }

  for (let d = 1; d <= daysAhead; d++) {
    const refDay = today.clone().add(d, "days").add(10, "hours"); // 10AM, como el cron real

    const dayCandidates = [];
    for (const rule of rules) {
      const cutoff = refDay.clone().subtract(rule.followUpDays, "days").toDate();
      const tooOldCutoff = refDay.clone().subtract(rule.followUpDays + MAX_OVERDUE_DAYS, "days").toDate();

      for (const appt of allAttended) {
        if (String(appt.service) !== String(rule._id)) continue;
        if (simulatedSent.has(String(appt._id))) continue;
        const start = new Date(appt.startDate);
        if (start <= cutoff && start > tooOldCutoff) {
          dayCandidates.push({ appt, rule });
        }
      }
    }

    if (!dayCandidates.length) continue;

    // Más reciente por cliente entre las reglas que matchean ese día.
    const latestByClient = new Map();
    for (const c of dayCandidates) {
      const clientId = String(c.appt.client?._id || c.appt.client || "");
      if (!clientId) continue;
      const existing = latestByClient.get(clientId);
      if (!existing || new Date(c.appt.startDate) > new Date(existing.appt.startDate)) {
        latestByClient.set(clientId, c);
      }
    }

    // Todos los candidatos del día quedan "resueltos" (marcados) ese día,
    // se envíen o no — igual que el job real.
    for (const c of dayCandidates) {
      simulatedSent.add(String(c.appt._id));
    }

    for (const { appt, rule } of latestByClient.values()) {
      const client = appt.client;
      if (!client || !client.phone_e164) continue;
      if (alreadyFollowedUpCache.get(String(appt._id))) continue;

      const followUpService = followUpServiceById.get(String(rule.followUpServiceId));
      results.push({
        date: refDay.format("YYYY-MM-DD"),
        client: client.name,
        phone: client.phone_e164,
        rule: rule.name,
        followUpService: followUpService.name,
        apptStartDate: moment.tz(appt.startDate, tz).format("YYYY-MM-DD"),
      });
    }
  }

  console.log(`\n=== Envíos proyectados en los próximos ${daysAhead} días (${results.length}) ===`);
  if (!results.length) {
    console.log("  (ninguno)");
  } else {
    let lastDate = null;
    for (const r of results) {
      if (r.date !== lastDate) {
        console.log(`\n${r.date}:`);
        lastDate = r.date;
      }
      console.log(`  - ${r.client} (${r.phone}) — "${r.rule}" (${r.apptStartDate}) → recordatorio de "${r.followUpService}"`);
    }
  }

  console.log(
    "\nNota: esta proyección asume que el cliente NO reserva/asiste al servicio de seguimiento antes de esa fecha; si lo hace, ese envío se cancela solo (se marca resuelto sin enviar)."
  );

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("✖ Error:", err);
  process.exit(1);
});
