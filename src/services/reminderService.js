// services/reminderService.js (agenda-backend)
import { waBulkSend, waBulkOptIn } from "./waHttpService.js";
import appointmentModel from "../models/appointmentModel.js";
import organizationModel from "../models/organizationModel.js";
import whatsappTemplates from "../utils/whatsappTemplates.js";
import {
  normalizeToCOE164,
  getBogotaDayWindowUTC,
  getDayWindowUTC,
  sleep,
} from "../utils/timeAndPhones.js";
import { messageTplReminder } from "../utils/bulkTemplates.js";

export const reminderService = {
  /**
   * Envía recordatorios de las citas de un día específico (no solo hoy)
   * agrupando por organización y por teléfono del cliente.
   *
   * @param {Object} params
   * @param {string} [params.orgId]           - Si se pasa, filtra por organización
   * @param {boolean} [params.dryRun=false]   - Si true, prepara pero no envía
   * @param {string|Date} [params.targetDate] - Fecha objetivo (ej: "2025-11-24" o ISO)
   */
  sendDailyRemindersViaCampaign: async ({
    orgId,
    dryRun = false,
    targetDate,
  } = {}) => {
    // 🔧 FIX: Si se pasa orgId, obtener la organización primero para usar su timezone
    let dayStartUTC, dayEndUTC;
    
    if (orgId) {
      const org = await organizationModel.findById(orgId);
      if (!org) {
        console.error(`[RemindersBulk] Organización ${orgId} no encontrada`);
        return { ok: false, created: 0, results: [] };
      }
      const timezone = org.timezone || "America/Bogota";
      ({ dayStartUTC, dayEndUTC } = getDayWindowUTC(targetDate, timezone));
    } else {
      // Si no se pasa orgId, usar ventana de Bogotá (compatibilidad)
      ({ dayStartUTC, dayEndUTC } = getBogotaDayWindowUTC(targetDate));
    }

    // 1) Traer citas de ese día aún no notificadas
    const appointments = await appointmentModel
      .find({
        ...(orgId ? { organizationId: orgId } : {}),
        startDate: { $gte: dayStartUTC, $lt: dayEndUTC },
        reminderSent: false,
      })
      .populate("client service employee organizationId");


    if (!appointments.length) {
      console.log("[RemindersBulk] No hay citas en la fecha seleccionada sin recordatorio enviado.");
      return { ok: true, created: 0, results: [] };
    }

    console.log(`[RemindersBulk] Encontradas ${appointments.length} citas sin recordatorio enviado para la fecha seleccionada`);
    console.log(`[RemindersBulk] Citas encontradas:`, appointments.map(a => ({
      id: a._id,
      cliente: a.client?.name,
      telefono: a.client?.phoneNumber,
      servicio: a.service?.name,
      inicio: a.startDate,
      status: a.status,
      reminderSent: a.reminderSent
    })));

    // 2) Agrupar por organización
    const byOrg = new Map();
    for (const a of appointments) {
      const _orgId = a?.organizationId?._id?.toString();
      if (!_orgId) continue;
      if (!byOrg.has(_orgId)) byOrg.set(_orgId, []);
      byOrg.get(_orgId).push(a);
    }

    const results = [];

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

      // 🔧 FIX: Usar la timezone de la organización para los formatos de fecha
      const timezone = org?.timezone || "America/Bogota";
      
      // Formatters con la timezone correcta de la organización
      const fmtHour = new Intl.DateTimeFormat("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: timezone,
      });
      const fmtDay = new Intl.DateTimeFormat("es-ES", {
        day: "numeric",
        month: "long",
        timeZone: timezone,
      });

      // --- Unificar por teléfono ---
      const byPhone = new Map();
      let skippedNoPhone = 0;
      
      for (const a of appts) {
        // 🔧 FIX: Normalizar teléfono igual que en el cronjob automático
        const rawPhone = a?.client?.phoneNumber;
        const phoneE164 = normalizeToCOE164(rawPhone); // Devuelve +57XXXXXXXXXX o +521XXXXXXXXXX
        if (!phoneE164) {
          skippedNoPhone++;
          console.warn(`[${_orgId}] Cita ${a._id} sin teléfono válido. Cliente: ${a?.client?.name}, Tel: ${rawPhone}`);
          continue;
        }
        
        // Baileys (WhatsApp Web) requiere el número SIN el símbolo +
        const phone = phoneE164.replace('+', ''); // -> 57XXXXXXXXXX o 521XXXXXXXXXX

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
            services: [],
            firstStart: start,
            lastEnd: end || start,
            employees: new Set(),
            apptIds: new Set(),
            actionLink: null,
          });
        }

        const bucket = byPhone.get(phone);
        bucket.services.push({ name: serviceName, time: timeLabel });
        if (start < bucket.firstStart) bucket.firstStart = start;
        if ((end || start) > bucket.lastEnd) bucket.lastEnd = end || start;
        if (a?.employee?.names) bucket.employees.add(a.employee.names);
        bucket.apptIds.add(String(a._id));
        if (!bucket.actionLink && a?.cancellationLink) {
          bucket.actionLink = a.cancellationLink;
        }
      }

      console.log(`[${_orgId}] Procesadas ${appts.length} citas: ${byPhone.size} números válidos, ${skippedNoPhone} omitidas por teléfono inválido`);

      // 4) Construir items de campaña finales con templates personalizados
      const items = [];
      const includedIds = [];

      for (const bucket of byPhone.values()) {
        if (!bucket.services.length) continue;

        // 🔧 Validar que el teléfono sea válido antes de continuar
        if (!bucket.phone || typeof bucket.phone !== 'string' || bucket.phone.trim() === '') {
          console.warn(`[${_orgId}] Bucket sin teléfono válido, omitiendo:`, bucket.names);
          continue;
        }

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
          manage_block: bucket.actionLink
            ? `${bucket.actionLink}\n\n`
            : "",
        };

        // 🆕 Renderizar mensaje con template personalizado de la organización
        let renderedMessage = messageTplReminder; // fallback a default
        try {
          renderedMessage = await whatsappTemplates.getRenderedTemplate(
            _orgId,
            'reminder',
            vars
          );
        } catch (e) {
          console.warn(
            `[${_orgId}] No se pudo obtener template personalizado reminder, usando default:`,
            e?.message
          );
          // Renderizar con template por defecto
          renderedMessage = messageTplReminder;
          for (const [key, value] of Object.entries(vars)) {
            const regex = new RegExp(`{{${key}}}`, 'g');
            renderedMessage = renderedMessage.replace(regex, value);
          }
        }

        // 🔧 Validar que el mensaje renderizado no esté vacío
        if (!renderedMessage || renderedMessage.trim() === '') {
          console.warn(`[${_orgId}] Mensaje vacío para ${bucket.phone}, omitiendo`);
          continue;
        }

        items.push({ phone: bucket.phone, message: renderedMessage });
        includedIds.push(...Array.from(bucket.apptIds));
      }

      if (!items.length) {
        console.log(`[${_orgId}] No hay items válidos (teléfonos/vars). Total citas: ${appts.length}, Buckets procesados: ${byPhone.size}`);
        continue;
      }

      console.log(`[${_orgId}] Preparando ${items.length} mensajes para ${byPhone.size} números únicos`);

      // 5) (opcional) Sincronizar opt-in
      try {
        await waBulkOptIn(items.map((it) => it.phone));
      } catch (e) {
        console.warn(`[${_orgId}] OptIn falló: ${e?.message || e}`);
      }

      // 6) Enviar campaña con mensajes pre-renderizados
      const targetDateForTitle = targetDate ? new Date(targetDate) : new Date();
      const titleDateStr = targetDateForTitle.toISOString().slice(0, 10);

      const title = `Recordatorios ${titleDateStr} (${org?.name || _orgId})`;

      const r = await waBulkSend({
        clientId,
        title,
        items,
        messageTpl: messageTplReminder, // Requerido por el servidor aunque no se use con preRendered
        preRendered: true, // 🆕 Items tienen 'message' pre-renderizado, no 'vars' + 'messageTpl'
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
