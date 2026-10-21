// services/waQuotaService.js
//
// Tope mensual de "citas con WhatsApp automático" para planes de entrada
// (Plan.limits.maxWhatsappAppointmentsPerMonth; null = sin tope). La unidad es
// la VISITA: citas del mismo grupo el mismo día cuentan una vez, y la
// confirmación y los recordatorios de esa visita comparten el cupo. El mes es
// el de la cita (timezone de la org). Pasado el tope la agenda sigue igual:
// solo dejan de salir confirmaciones y recordatorios automáticos.

import moment from "moment-timezone";
import WaQuotaUsage from "../models/waQuotaUsageModel.js";
import organizationModel from "../models/organizationModel.js";
import WhatsappTemplate from "../models/whatsappTemplateModel.js";
import membershipService from "./membershipService.js";
import notificationService from "./notificationService.js";
import subscriptionService from "./subscriptionService.js";

export const WA_QUOTA_BLOCKED_REASON = "Límite mensual de citas con WhatsApp del plan alcanzado";

const visitKey = (appt, tz) =>
  `${appt.groupId || appt._id}:${moment.tz(appt.startDate, tz).format("YYYY-MM-DD")}`;
const periodOf = (date, tz) => moment.tz(date, tz).format("YYYY-MM");

async function timezoneOf(organizationId, timezone) {
  if (timezone) return timezone;
  const org = await organizationModel.findById(organizationId).select("timezone").lean();
  return org?.timezone || "America/Bogota";
}

// Aviso único al 80% y al 100% del tope (solo la reserva que cruza el umbral lo dispara)
async function notifyThreshold(organizationId, used, limit) {
  const warnAt = Math.ceil(limit * 0.8);
  if (used !== warnAt && used !== limit) return;
  const full = used === limit;
  const title = full ? "Llegaste al tope de WhatsApp de tu plan" : "Te quedan pocas citas con WhatsApp este mes";
  const message = full
    ? `Usaste las ${limit} citas con confirmación y recordatorio por WhatsApp de este mes. Tu agenda sigue funcionando, pero las próximas citas no recibirán mensajes automáticos. Pásate al Plan Esencial para tener WhatsApp sin tope.`
    : `Llevas ${used} de ${limit} citas con WhatsApp este mes. Si las superas, las siguientes citas no recibirán mensajes automáticos hasta el próximo mes.`;
  try {
    const org = await organizationModel.findById(organizationId).select("branding").lean();
    await Promise.allSettled([
      notificationService.createNotification({ title, message, organizationId, type: "system", frontendRoute: "/my-membership", status: "unread" }),
      subscriptionService.sendNotificationToUser(organizationId, JSON.stringify({ title, message, icon: org?.branding?.pwaIcon })),
    ]);
  } catch (err) {
    console.error("[waQuota] Error notificando umbral:", err.message);
  }
}

// Intenta contar una visita en el cupo del mes. true = puede recibir WhatsApp.
async function reserveKey(organizationId, period, key, limit) {
  // Asegura el documento del mes (sin tocar el contador si ya existía)
  await WaQuotaUsage.updateOne(
    { organizationId, period },
    { $setOnInsert: { count: 0, keys: [] } },
    { upsert: true }
  ).catch((err) => { if (err?.code !== 11000) throw err; });

  // Atómico: solo cuenta si la visita es nueva y queda cupo
  const updated = await WaQuotaUsage.findOneAndUpdate(
    { organizationId, period, keys: { $ne: key }, count: { $lt: limit } },
    { $inc: { count: 1 }, $addToSet: { keys: key } },
    { new: true }
  ).lean();
  if (updated) {
    notifyThreshold(organizationId, updated.count, limit);
    return true;
  }
  // Sin cupo nuevo: vale solo si esta visita ya estaba contada
  return !!(await WaQuotaUsage.exists({ organizationId, period, keys: key }));
}

const waQuotaService = {
  /**
   * Reserva cupo de WhatsApp para las citas dadas (necesitan _id, startDate y,
   * si lo tienen, groupId). Devuelve el Set de ids que SÍ pueden recibir
   * mensajes automáticos. Sin tope en el plan → todas.
   * @param {Object} [opts] - { limits, timezone } para evitar consultas repetidas
   */
  async reserve(organizationId, appointments, opts = {}) {
    const ids = (appointments || []).map((a) => String(a._id));
    const limits = opts.limits !== undefined ? opts.limits : await membershipService.getPlanLimits(organizationId);
    const limit = limits?.maxWhatsappAppointmentsPerMonth;
    if (limit === null || limit === undefined) return new Set(ids);

    const tz = await timezoneOf(organizationId, opts.timezone);
    const byKey = new Map();
    for (const appt of [...appointments].sort((a, b) => new Date(a.startDate) - new Date(b.startDate))) {
      const key = visitKey(appt, tz);
      if (!byKey.has(key)) byKey.set(key, { period: periodOf(appt.startDate, tz), ids: [] });
      byKey.get(key).ids.push(String(appt._id));
    }

    const allowed = new Set();
    for (const [key, { period, ids: keyIds }] of byKey) {
      if (await reserveKey(organizationId, period, key, limit)) keyIds.forEach((id) => allowed.add(id));
    }
    return allowed;
  },

  /**
   * Compuerta única para confirmaciones de citas que se envían fuera de
   * appointmentService (reservas en línea aprobadas): plan
   * (autoConfirmations) → plantilla habilitada → tope mensual.
   * @returns {{ allowed: Set<string>, reason: string|null }} reason ≠ null = no enviar nada
   */
  async confirmationGate(organizationId, appointments, { templateType, timezone } = {}) {
    const limits = await membershipService.getPlanLimits(organizationId);
    if (limits && limits.autoConfirmations === false) {
      return { allowed: new Set(), reason: "Bloqueada por límite del plan (autoConfirmations)" };
    }
    if (templateType) {
      const tpl = await WhatsappTemplate.findOne({ organizationId }).select("enabledTypes").lean();
      if (tpl?.enabledTypes?.[templateType] === false) {
        return { allowed: new Set(), reason: `Deshabilitada en plantillas de WhatsApp (enabledTypes.${templateType})` };
      }
    }
    const allowed = await this.reserve(organizationId, appointments, { limits, timezone });
    return { allowed, reason: allowed.size === 0 ? WA_QUOTA_BLOCKED_REASON : null };
  },

  /** Consumo del mes actual (o del mes de `date`) para mostrarlo al negocio. */
  async getUsage(organizationId, { date = new Date(), timezone } = {}) {
    const limits = await membershipService.getPlanLimits(organizationId);
    const limit = limits?.maxWhatsappAppointmentsPerMonth ?? null;
    const tz = await timezoneOf(organizationId, timezone);
    const period = periodOf(date, tz);
    if (limit === null) return { limit: null, used: 0, remaining: null, period };
    const doc = await WaQuotaUsage.findOne({ organizationId, period }).select("count").lean();
    const used = doc?.count || 0;
    return { limit, used, remaining: Math.max(0, limit - used), period };
  },
};

export default waQuotaService;
