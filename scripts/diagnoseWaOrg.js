// scripts/diagnoseWaOrg.js
// Diagnóstico de "no salen los mensajes de WhatsApp" para una organización:
// conexión (Baileys/Meta), membresía/plan, cupo mensual, plantillas y el resultado
// del envío en las citas más recientes. Solo lectura.
// Uso: node scripts/diagnoseWaOrg.js <slug-o-dominio>
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV || "development"}` });

import mongoose from "mongoose";
import dbConnection from "../src/config/db.js";
import Organization from "../src/models/organizationModel.js";
import Appointment from "../src/models/appointmentModel.js";
import Membership from "../src/models/membershipModel.js";
import "../src/models/planModel.js";
import { waGetStatus } from "../src/services/waHttpService.js";

const term = process.argv[2];
if (!term) {
  console.error("Uso: node scripts/diagnoseWaOrg.js <slug-o-dominio>");
  process.exit(1);
}

const run = async () => {
  await dbConnection();

  const org = await Organization.findOne({
    $or: [{ slug: term }, { domains: { $regex: term, $options: "i" } }],
  }).lean();
  if (!org) {
    console.log("No se encontró la organización:", term);
    return;
  }

  console.log("\n=== Organización ===");
  console.log({
    _id: String(org._id),
    name: org.name,
    domains: org.domains,
    waConnectionType: org.waConnectionType,
    clientIdWhatsapp: org.clientIdWhatsapp,
    waPhone: org.waPhone,
    metaPhoneNumberId: org.metaPhoneNumberId,
    metaWabaId: org.metaWabaId,
    whatsappConnectedAt: org.onboardingMilestones?.whatsappConnectedAt,
    waDisconnectAlert: org.waDisconnectAlert,
    timezone: org.timezone,
  });

  const membership = await Membership.findOne({ organizationId: org._id })
    .sort({ createdAt: -1 })
    .populate("planId")
    .lean();
  console.log("\n=== Membresía ===");
  if (membership) {
    const l = membership.planId?.limits || {};
    console.log({
      status: membership.status,
      plan: membership.planId?.slug,
      currentPeriodEnd: membership.currentPeriodEnd,
      whatsappIntegration: l.whatsappIntegration,
      autoConfirmations: l.autoConfirmations,
      autoReminders: l.autoReminders,
      maxRemindersPerAppointment: l.maxRemindersPerAppointment,
      maxWhatsappAppointmentsPerMonth: l.maxWhatsappAppointmentsPerMonth,
    });
  } else {
    console.log("Sin membresía");
  }

  const quota = await mongoose.connection.db
    .collection("waquotausages")
    .find({ organizationId: org._id })
    .sort({ _id: -1 })
    .limit(3)
    .toArray();
  console.log("\n=== Cupo WhatsApp (WaQuotaUsage) ===");
  console.log(quota.map((q) => ({ period: q.period ?? q.month, count: q.count ?? q.used })));

  console.log("\n=== Sesión Baileys ===");
  if (org.clientIdWhatsapp) {
    try {
      console.log(await waGetStatus(org.clientIdWhatsapp));
    } catch (e) {
      console.log("Error consultando estado:", e?.response?.status, e?.response?.data || e.message);
    }
  } else {
    console.log("Sin clientIdWhatsapp");
  }

  const appts = await Appointment.find({ organizationId: org._id })
    .sort({ createdAt: -1 })
    .limit(15)
    .select("createdAt startDate status waConfirmationStatus waConfirmationError waConfirmationSentAt waConfirmationDeliveryStatus reminderSent reminders")
    .lean();
  console.log("\n=== Últimas 15 citas (por creación) ===");
  for (const a of appts) {
    console.log({
      createdAt: a.createdAt,
      startDate: a.startDate,
      status: a.status,
      wa: a.waConfirmationStatus,
      error: a.waConfirmationError,
      delivery: a.waConfirmationDeliveryStatus,
      reminderSent: a.reminderSent,
    });
  }
};

run()
  .catch((e) => console.error(e))
  .finally(() => mongoose.disconnect());
