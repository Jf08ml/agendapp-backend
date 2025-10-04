// services/reminderService.js (agenda-backend)
import { waBulkSend, waBulkOptIn } from "./waHttpService.js";
import appointmentModel from "../models/appointmentModel.js";
import {
  hasUsablePhone,
  getBogotaTodayWindowUTC,
  sleep,
} from "../utils/timeAndPhones.js";
import { messageTplReminder } from "../utils/bulkTemplates.js";

export const reminderService = {
  sendDailyRemindersViaCampaign: async ({ orgId, dryRun = false } = {}) => {
    const { dayStartUTC, dayEndUTC } = getBogotaTodayWindowUTC();

    const appointments = await appointmentModel
      .find({
        ...(orgId ? { organizationId: orgId } : {}),
        startDate: { $gte: dayStartUTC, $lt: dayEndUTC },
        reminderSent: false,
      })
      .populate("client service employee organizationId");

    if (!appointments.length) {
      console.log("[RemindersBulk] No hay citas hoy.");
      return { ok: true, created: 0 };
    }

    // agrupar por org
    const byOrg = new Map();
    for (const a of appointments) {
      const orgId = a?.organizationId?._id?.toString();
      if (!orgId) continue;
      if (!byOrg.has(orgId)) byOrg.set(orgId, []);
      byOrg.get(orgId).push(a);
    }

    const results = [];

    for (const [orgId, appts] of byOrg.entries()) {
      const org = appts[0]?.organizationId;
      const clientId = org?.clientIdWhatsapp;
      if (!clientId) {
        console.warn(`[${orgId}] Sin clientIdWhatsapp, omito ${appts.length}.`);
        continue;
      }

      // construir items
      const items = [];
      for (const a of appts) {
        const normalized = hasUsablePhone(a?.client?.phoneNumber);
        if (!normalized) continue; // si no es válido/normalizable, lo saltamos

        const appointmentDateTime = new Intl.DateTimeFormat("es-ES", {
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
          timeZone: "America/Bogota",
        }).format(new Date(a.startDate));

        const vars = {
          names: a?.client?.name || "Cliente",
          date: appointmentDateTime,
          organization: org?.name || "",
          employee: a?.employee?.names || "",
          service: a?.service
            ? `${a.service.type || ""} - ${a.service.name || ""}`.trim()
            : "",
        };

        items.push({ phone: normalized, vars });
      }

      if (!items.length) continue;

      // (opcional) sincronizar opt-in basado en tu DB:
      try {
        await waBulkOptIn(items.map((it) => it.phone));
      } catch (e) {
        console.warn(`[${orgId}] OptIn falló: ${e.message}`);
      }

      // enviar campaña
      const title = `Recordatorios ${new Date().toISOString().slice(0, 10)} (${
        org?.name || orgId
      })`;
      const r = await waBulkSend({
        clientId,
        title,
        items,
        messageTpl: messageTplReminder,
        dryRun,
      });

      console.log(
        `[${orgId}] Enviados ${r.prepared} mensajes (dryRun=${dryRun})`
      );

      results.push({ orgId, bulkId: r.bulkId, prepared: r.prepared, title });
      // 👇 Opcional: marca preventivamente las citas para no reintentar en el mismo día (estrategia "optimista")
      await appointmentModel.updateMany(
        { _id: { $in: appts.map((a) => a._id) } },
        { $set: { reminderSent: true, reminderBulkId: r.bulkId } }
      );

      // pequeño respiro si quieres
      await sleep(200);
    }

    return { ok: true, results };
  },
};
