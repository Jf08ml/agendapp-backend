import mongoose from "mongoose";
import Organization from "../models/organizationModel.js";
import Membership from "../models/membershipModel.js";
import Plan from "../models/planModel.js";
import PlatformWaMessage from "../models/platformWaMessageModel.js";
import OficinaOutreachSend from "../models/oficinaOutreachSendModel.js";
import { isOficinaLineConfigured, sendPlatformTemplate, sendTextMessage } from "./metaApiService.js";
import { logOutboundMessage } from "./platformInboxService.js";
import { PLATFORM_TEMPLATE_BODIES, renderPlatformTemplate } from "./platformTemplateCatalog.js";

/**
 * API para AgenditApp Oficina IA, trabajador de activación (contrato en
 * agenditapp-oficina/docs/ACTIVACION.md).
 *
 * - Nunca entrega teléfonos ni correos: la Oficina pide el envío por id de
 *   organización y aquí se resuelve el número.
 * - Los parámetros de las plantillas (nombre, enlaces, días de prueba) los
 *   calcula este backend; al enviar se vuelven a calcular y, si no coinciden
 *   con lo aprobado en la Oficina, el envío se rechaza.
 * - Envío idempotente por messageId (OficinaOutreachSend).
 * - Se respeta la baja (Organization.outreach.optedOutAt) y la ventana de 24 h
 *   de WhatsApp para el texto libre.
 * - Envía desde el número de soporte y ventas (META_OFICINA_PHONE_NUMBER_ID,
 *   línea "oficina"), nunca desde el oficial. La ventana de 24 h es de ese número;
 *   los días desde el último mensaje cuentan los dos números.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const REPLY_WINDOW_MS = DAY_MS;
const MAX_ORGANIZATIONS = 1000;
const MAX_IDS = 100;

// Para qué sirve cada plantilla aprobada del número de plataforma.
const TEMPLATE_PURPOSE = {
  activa_tu_cuenta: "Se registró pero no terminó la configuración inicial",
  agenda_tu_primera_cita: "Configuró, pero no ha creado su primera cita",
  conecta_tu_whatsapp: "Ya usa la agenda, pero no ha conectado su WhatsApp",
  trial_por_vencer: "La prueba gratis termina en pocos días",
  mejora_tu_plan: "Está en el plan gratuito (sin WhatsApp automático): invitarlo a un plan pago",
};

// Plan de la prueba. Al vencer, el producto pasa el negocio al plan gratuito
// (membershipService.convertTrialToFree): membresía "active", precio 0, sin WhatsApp.
const TRIAL_PLAN = "plan-demo";

/** Plan gratuito: sin costo y fuera de la prueba. No paga, aunque la membresía diga "active". */
function isFreePlan(membership) {
  const plan = membership?.plan;
  return Boolean(plan) && plan.price === 0 && plan.slug !== TRIAL_PLAN && membership.status !== "trial";
}

/** Fin de la prueba. El producto la vence por currentPeriodEnd; trialEnd queda viejo si se extendió. */
function trialEndOf(membership) {
  if (membership?.status !== "trial") return membership?.trialEnd || null;
  return membership.currentPeriodEnd || membership.trialEnd || null;
}

export class OutreachBlocked extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Falta configurar el número de envío: no salió nada y se puede reintentar después. */
export class OutreachNotConfigured extends Error {
  constructor() {
    super("El número de soporte y ventas (META_OFICINA_PHONE_NUMBER_ID) no está configurado en el backend");
    this.code = "line_not_configured";
  }
}

const LINE = "oficina";
const isLine = (line) => ({ $eq: [{ $ifNull: [line, "platform"] }, LINE] });

function orgLink(org, path) {
  return org.slug ? `https://${org.slug}.agenditapp.com${path}` : null;
}

function ownerName(org) {
  return org.ownerName || org.name;
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

/** Días que le quedan a la membresía (igual que Membership.daysUntilExpiration). */
function daysLeft(membership, now = new Date()) {
  if (!membership?.currentPeriodEnd) return null;
  return Math.ceil((new Date(membership.currentPeriodEnd) - now) / DAY_MS);
}

/**
 * Parámetros vigentes de cada plantilla para un negocio, en el orden {{1}}..{{n}}.
 * Solo aparecen las plantillas que aplican hoy a ese negocio.
 */
export function templateParamsFor(org, membership, now = new Date()) {
  const ms = org.onboardingMilestones || {};
  const params = {};
  const add = (name, path, extra = []) => {
    const link = orgLink(org, path);
    if (!link) return;
    params[name] = extra.length ? [ownerName(org), org.name, ...extra, link] : [ownerName(org), org.name, link];
  };
  if (!org.setupCompleted) add("activa_tu_cuenta", "/login-admin");
  if (org.setupCompleted && !ms.firstAppointmentAt) add("agenda_tu_primera_cita", "/gestionar-agenda");
  // El plan gratuito no incluye WhatsApp: invitarlo a conectarlo sería engañoso.
  const free = isFreePlan(membership);
  if (org.setupCompleted && !ms.whatsappConnectedAt && !free) add("conecta_tu_whatsapp", "/gestionar-whatsapp");
  const left = daysLeft(membership, now);
  if (membership?.status === "trial" && left !== null && left >= 1 && left <= 7) {
    add("trial_por_vencer", "/my-membership", [String(left)]);
  }
  if (free) add("mejora_tu_plan", "/my-membership");
  // Mismo colapso de espacios que sendPlatformTemplate antes de enviar a Meta.
  for (const name of Object.keys(params)) params[name] = params[name].map((p) => String(p).replace(/\s+/g, " ").trim() || "—");
  return params;
}

export function templateCatalog() {
  return Object.entries(PLATFORM_TEMPLATE_BODIES).map(([name, body]) => ({
    name,
    body,
    paramCount: new Set(body.match(/\{\{\d+\}\}/g) || []).size,
    purpose: TEMPLATE_PURPOSE[name] || "",
  }));
}

/** Última membresía de cada organización, con su plan (slug, nombre, precio y si incluye WhatsApp). */
async function latestMemberships(orgIds) {
  const rows = await Membership.aggregate([
    { $match: { organizationId: { $in: orgIds } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$organizationId", doc: { $first: "$$ROOT" } } },
    {
      $lookup: {
        from: Plan.collection.name,
        localField: "doc.planId",
        foreignField: "_id",
        pipeline: [{ $project: { slug: 1, displayName: 1, price: 1, "limits.whatsappIntegration": 1 } }],
        as: "plan",
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), { ...r.doc, plan: r.plan[0] || null }]));
}

/**
 * Por organización: último mensaje recibido en el número de la Oficina (abre la
 * ventana de 24 h de ese número) y último enviado desde cualquiera de los dos.
 */
async function lastMessages(orgIds) {
  const rows = await PlatformWaMessage.aggregate([
    { $match: { organizationId: { $in: orgIds } } },
    {
      $group: {
        _id: "$organizationId",
        inbound: {
          $max: { $cond: [{ $and: [{ $eq: ["$direction", "inbound"] }, isLine("$line")] }, "$createdAt", null] },
        },
        outbound: { $max: { $cond: [{ $eq: ["$direction", "outbound"] }, "$createdAt", null] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), { inbound: r.inbound, outbound: r.outbound }]));
}

function factsOf(org, membership, messages, now) {
  const ms = org.onboardingMilestones || {};
  // Las organizaciones más antiguas no tienen createdAt: su _id guarda cuándo se creó.
  const registeredAt = org.createdAt || org._id.getTimestamp();
  return {
    id: String(org._id),
    name: org.name,
    contactName: ownerName(org) || null,
    createdAt: iso(registeredAt),
    hasPhone: Boolean(org.phoneNumber),
    optedOut: Boolean(org.outreach?.optedOutAt),
    waAgentEnabled: Boolean(org.waAgentEnabled),
    isActive: org.isActive !== false,
    milestones: {
      // Los registros anteriores al hito solo tienen el booleano setupCompleted.
      setupCompletedAt: iso(ms.setupCompletedAt || (org.setupCompleted ? registeredAt : null)),
      seededDemoAt: iso(ms.seededDemoAt),
      firstAppointmentAt: iso(ms.firstAppointmentAt),
      whatsappConnectedAt: iso(ms.whatsappConnectedAt),
      firstAutoMessageAt: iso(ms.firstAutoMessageAt),
      firstOnlineBookingAt: iso(ms.firstOnlineBookingAt),
    },
    membership: membership
      ? {
          status: membership.status,
          trialEnd: iso(trialEndOf(membership)),
          currentPeriodEnd: iso(membership.currentPeriodEnd),
          plan: membership.plan
            ? {
                slug: membership.plan.slug,
                name: membership.plan.displayName,
                price: membership.plan.price,
                whatsappIntegration: membership.plan.limits?.whatsappIntegration !== false,
              }
            : null,
        }
      : null,
    lastInboundAt: iso(messages?.inbound),
    lastOutboundAt: iso(messages?.outbound),
    templateParams: templateParamsFor(org, membership, now),
  };
}

const ORG_FIELDS =
  "name ownerName slug phoneNumber createdAt isActive setupCompleted waAgentEnabled onboardingMilestones outreach";

/** Negocios con sus hitos y su estado de contacto. Por ids, todos, o los registrados en los últimos días. */
export async function listOrganizationsForOficina({ ids, createdSinceDays, all }) {
  const now = new Date();
  let filter = { createdAt: { $gte: new Date(now.getTime() - createdSinceDays * DAY_MS) } };
  if (ids?.length) filter = { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } };
  else if (all) filter = {};
  const found = await Organization.find(filter).select(ORG_FIELDS).sort({ createdAt: -1 }).limit(MAX_ORGANIZATIONS + 1).lean();
  const orgs = found.slice(0, MAX_ORGANIZATIONS);
  const orgIds = orgs.map((o) => o._id);
  const [memberships, messages] = await Promise.all([latestMemberships(orgIds), lastMessages(orgIds)]);
  return {
    generatedAt: now.toISOString(),
    // Hay más negocios que el máximo: faltan los más antiguos.
    truncated: found.length > MAX_ORGANIZATIONS,
    templates: templateCatalog(),
    organizations: orgs.map((o) => factsOf(o, memberships.get(String(o._id)), messages.get(String(o._id)), now)),
  };
}

export async function listMessagesForOficina(organizationId, limit) {
  const rows = await PlatformWaMessage.find({ organizationId: new mongoose.Types.ObjectId(organizationId) })
    .select("direction source line templateName body createdAt")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return rows.reverse().map((m) => ({
    direction: m.direction,
    source: m.source,
    line: m.line === LINE ? LINE : "platform",
    templateName: m.templateName || null,
    body: String(m.body || "").slice(0, 4000),
    at: iso(m.createdAt),
  }));
}

export async function setOptOut(organizationId, optedOut, source) {
  const result = await Organization.updateOne(
    { _id: new mongoose.Types.ObjectId(organizationId) },
    { $set: { "outreach.optedOutAt": optedOut ? new Date() : null, "outreach.optedOutSource": optedOut ? source : null } }
  );
  return result.matchedCount === 1;
}

/**
 * Envía un mensaje aprobado en la Oficina. Devuelve { status: "sent", ... } o
 * lanza OutreachBlocked (regla) o un error de WhatsApp (con .retriable).
 */
export async function sendForOficina(input) {
  const existing = await OficinaOutreachSend.findOne({ messageId: input.messageId }).lean();
  if (existing?.status === "sent") {
    return { status: "sent", metaMessageId: existing.metaMessageId, sentAt: iso(existing.sentAt), duplicate: true };
  }
  if (existing?.status === "sending") {
    throw new OutreachBlocked("in_progress", "Otro intento con el mismo messageId está en curso");
  }
  if (!isOficinaLineConfigured()) throw new OutreachNotConfigured();

  const org = await Organization.findById(input.organizationId).select(ORG_FIELDS).lean();
  if (!org) throw new OutreachBlocked("not_found", "El negocio no existe");
  if (org.outreach?.optedOutAt) throw new OutreachBlocked("opted_out", "El negocio pidió no recibir mensajes");
  if (!org.phoneNumber) throw new OutreachBlocked("no_phone", "El negocio no tiene teléfono");

  let send;
  if (input.channel.kind === "text") {
    const lastInbound = await PlatformWaMessage.findOne({ organizationId: org._id, direction: "inbound", line: LINE })
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean();
    if (!lastInbound || Date.now() - new Date(lastInbound.createdAt).getTime() >= REPLY_WINDOW_MS) {
      throw new OutreachBlocked("outside_window", "El texto libre solo se puede enviar en las 24 h siguientes a un mensaje del negocio");
    }
    if (input.preview !== input.channel.text) throw new OutreachBlocked("preview_mismatch", "El texto no coincide con el aprobado");
    send = () => sendTextMessage(org.phoneNumber, input.channel.text, LINE);
  } else {
    const { templateName, params } = input.channel;
    if (!PLATFORM_TEMPLATE_BODIES[templateName]) throw new OutreachBlocked("template_unavailable", "La plantilla no está en el catálogo");
    const memberships = await latestMemberships([org._id]);
    const current = templateParamsFor(org, memberships.get(String(org._id)))[templateName];
    if (!current) throw new OutreachBlocked("template_unavailable", "La plantilla ya no aplica a este negocio");
    if (current.length !== params.length || current.some((p, i) => p !== params[i])) {
      throw new OutreachBlocked("template_changed", "Los datos de la plantilla cambiaron desde que se aprobó");
    }
    if (renderPlatformTemplate(templateName, params) !== input.preview) {
      throw new OutreachBlocked("template_changed", "El texto de la plantilla no coincide con el aprobado");
    }
    send = () => sendPlatformTemplate(org.phoneNumber, templateName, params, LINE);
  }

  // Reclamo atómico: un messageId nuevo se inserta; uno fallido se reclama de nuevo.
  try {
    if (existing) {
      const claimed = await OficinaOutreachSend.updateOne({ messageId: input.messageId, status: "failed" }, { $set: { status: "sending", error: null } });
      if (claimed.modifiedCount !== 1) throw new OutreachBlocked("in_progress", "Otro intento con el mismo messageId está en curso");
    } else {
      await OficinaOutreachSend.create({
        messageId: input.messageId,
        organizationId: org._id,
        kind: input.channel.kind,
        templateName: input.channel.kind === "template" ? input.channel.templateName : null,
        status: "sending",
      });
    }
  } catch (err) {
    if (err?.code === 11000) throw new OutreachBlocked("in_progress", "Otro intento con el mismo messageId está en curso");
    throw err;
  }

  let messageId;
  try {
    ({ messageId } = await send());
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.error?.message || err.message;
    // Con respuesta de Meta, el mensaje no salió: se puede reintentar. Sin respuesta, no se sabe.
    if (status) {
      await OficinaOutreachSend.updateOne({ messageId: input.messageId }, { $set: { status: "failed", error: String(detail).slice(0, 500) } });
      const error = new Error(`WhatsApp rechazó el envío: ${detail}`);
      error.retriable = status === 429 || status >= 500;
      error.whatsapp = true;
      throw error;
    }
    throw err;
  }

  const sentAt = new Date();
  await OficinaOutreachSend.updateOne(
    { messageId: input.messageId },
    { $set: { status: "sent", metaMessageId: messageId || null, sentAt } }
  );
  await logOutboundMessage({
    phone: org.phoneNumber,
    organizationId: org._id,
    body: input.preview,
    source: "oficina",
    templateName: input.channel.kind === "template" ? input.channel.templateName : null,
    metaMessageId: messageId,
    line: LINE,
  }).catch((err) => console.error("[oficinaOutreach] Error guardando el envío en el inbox:", err.message));
  return { status: "sent", metaMessageId: messageId || null, sentAt: sentAt.toISOString(), duplicate: false };
}

// Mensajes con los que un negocio pide no recibir más mensajes. Solo el mensaje
// completo (con signos alrededor), para no dar de baja a quien escribe "no" a otra cosa.
const OPT_OUT_PATTERN =
  /^\s*[¡!¿]*\s*(baja|stop|parar|darme de baja|no me escriban( m[aá]s)?|no quiero (recibir )?(m[aá]s )?mensajes|no m[aá]s mensajes)\s*[.!¡]*\s*$/i;

export function isOptOutMessage(body) {
  return OPT_OUT_PATTERN.test(String(body || ""));
}
