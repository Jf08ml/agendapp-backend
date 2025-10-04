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
  /**
   * Envía recordatorios de las citas del día agrupando por organización y por teléfono del cliente.
   * Un cliente con varias citas en el día recibirá un solo mensaje con la lista de servicios/horas.
   *
   * @param {Object} params
   * @param {string} [params.orgId] - Si se pasa, filtra por organización
   * @param {boolean} [params.dryRun=false] - Si true, prepara pero no envía
   */
  sendDailyRemindersViaCampaign: async ({ orgId, dryRun = false } = {}) => {
    const { dayStartUTC, dayEndUTC } = getBogotaTodayWindowUTC();

    // 1) Traer citas de hoy aún no notificadas
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

    // 2) Agrupar por organización
    const byOrg = new Map();
    for (const a of appointments) {
      const _orgId = a?.organizationId?._id?.toString();
      if (!_orgId) continue;
      if (!byOrg.has(_orgId)) byOrg.set(_orgId, []);
      byOrg.get(_orgId).push(a);
    }

    const results = [];

    // Formatters reutilizables
    const fmtHour = new Intl.DateTimeFormat("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/Bogota",
    });
    const fmtDay = new Intl.DateTimeFormat("es-ES", {
      day: "numeric",
      month: "long",
      timeZone: "America/Bogota",
    });

    // 3) Por cada organización, construir campañas con items unificados por teléfono
    for (const [_orgId, appts] of byOrg.entries()) {
      const org = appts[0]?.organizationId;
      const clientId = org?.clientIdWhatsapp;
      if (!clientId) {
        console.warn(
          `[${_orgId}] Sin clientIdWhatsapp, omito ${appts.length}.`
        );
        continue;
      }

      // --- Unificar por teléfono ---
      // phone -> bucket con info agregada
      const byPhone = new Map();
      for (const a of appts) {
        const phone = hasUsablePhone(a?.client?.phoneNumber);
        if (!phone) continue; // ignora si no es normalizable/usable

        const start = new Date(a.startDate);
        const end = a.endDate ? new Date(a.endDate) : null;

        const serviceName = a?.service
          ? `${a.service.type || ""} - ${a.service.name || ""}`.trim()
          : "Servicio";

        const timeLabel = end
          ? `${fmtHour.format(start)} – ${fmtHour.format(end)}`
          : `${fmtHour.format(start)}`;

        if (!byPhone.has(phone)) {
          byPhone.set(phone, {
            phone,
            names: a?.client?.name || "Cliente",
            services: [], // { name, time }
            firstStart: start,
            lastEnd: end || start,
            employees: new Set(),
            apptIds: new Set(),
          });
        }

        const bucket = byPhone.get(phone);
        bucket.services.push({ name: serviceName, time: timeLabel });
        if (start < bucket.firstStart) bucket.firstStart = start;
        if ((end || start) > bucket.lastEnd) bucket.lastEnd = end || start;
        if (a?.employee?.names) bucket.employees.add(a.employee.names);
        bucket.apptIds.add(String(a._id));
      }

      // 4) Construir items de campaña finales
      const items = [];
      const includedIds = [];

      for (const bucket of byPhone.values()) {
        if (!bucket.services.length) continue;

        const servicesList = bucket.services
          .map((s, i) => `  ${i + 1}. ${s.name} (${s.time})`)
          .join("\n");

        const dateRange =
          bucket.firstStart.getTime() === bucket.lastEnd.getTime()
            ? `${fmtDay.format(bucket.firstStart)} ${fmtHour.format(
                bucket.firstStart
              )}`
            : `${fmtDay.format(bucket.firstStart)} ${fmtHour.format(
                bucket.firstStart
              )} – ${fmtHour.format(bucket.lastEnd)}`;

        const countNum = bucket.services.length;
        const isSingle = countNum === 1;

        const vars = {
          names: bucket.names,
          date_range: dateRange,
          organization: org?.name || "",
          services_list: servicesList,
          employee: Array.from(bucket.employees).join(", "),
          count: String(countNum),
          cita_pal: isSingle ? "cita" : "citas",
          agendada_pal: isSingle ? "agendada" : "agendadas",
        };

        items.push({ phone: bucket.phone, vars });
        includedIds.push(...Array.from(bucket.apptIds));
      }

      if (!items.length) {
        console.log(`[${_orgId}] No hay items válidos (teléfonos/vars).`);
        continue;
      }

      // 5) (opcional) Sincronizar opt-in
      try {
        await waBulkOptIn(items.map((it) => it.phone));
      } catch (e) {
        console.warn(`[${_orgId}] OptIn falló: ${e?.message || e}`);
      }

      // 6) Enviar campaña
      const title = `Recordatorios ${new Date().toISOString().slice(0, 10)} (${
        org?.name || _orgId
      })`;

      const r = await waBulkSend({
        clientId,
        title,
        items,
        messageTpl: messageTplReminder,
        dryRun,
      });

      console.log(
        `[${_orgId}] Enviados ${r.prepared} mensajes (dryRun=${dryRun})`
      );

      results.push({
        orgId: _orgId,
        bulkId: r.bulkId,
        prepared: r.prepared,
        title,
      });

      // 7) Marcar como recordatorio enviado SOLO las citas incluidas
      try {
        if (includedIds.length) {
          await appointmentModel.updateMany(
            { _id: { $in: includedIds } },
            { $set: { reminderSent: true, reminderBulkId: r.bulkId } }
          );
        }
      } catch (e) {
        console.warn(
          `[${_orgId}] Error al marcar reminderSent: ${e?.message || e}`
        );
      }

      // 8) Pequeño respiro para no saturar
      await sleep(200);
    }

    return { ok: true, results };
  },
};
