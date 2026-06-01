/**
 * metaSendWhatsapp.js
 *
 * Handles sending WhatsApp notifications via Meta templates.
 * Mirrors the variable naming convention from MetaTemplateFormTab.tsx.
 *
 * Named variable mapping (Baileys data key → Meta template variable name):
 *   names           → nombre_cliente
 *   date/dateRange/date_range → fecha_cita
 *   organization    → nombre_negocio
 *   address         → direccion
 *   service         → servicio
 *   servicesList/services_list → lista_servicios
 *   employee        → profesional
 *   cancellationLink → enlace_cancelacion
 *   manage_block    → enlace_gestion
 *   appointments_list/appointmentsList → lista_citas
 *   reward          → premio
 *   count           → cantidad_citas
 *   cita_pal        → cita_o_citas
 *   agendada_pal    → agendada_o_agendadas
 *   recommendations → recomendaciones
 */

import { listTemplates, sendTemplateMessage, getOrgPrefix } from "./metaTemplateService.js";

// ── Template name mapping ────────────────────────────────────────────────────

const META_TEMPLATE_NAMES = {
  scheduleAppointment:       "confirmacion_cita",
  scheduleAppointmentBatch:  "confirmacion_cita",
  recurringAppointmentSeries:"citas_recurrentes",
  reminder:                  "recordatorio_cita",
  secondReminder:            "segundo_recordatorio",
  clientConfirmationAck:     "confirmacion_asistencia",
  clientCancellationAck:     "aviso_cancelacion",
  clientNoShowAck:           "aviso_no_asistencia",
  loyaltyServiceReward:      "premio_fidelidad",
  loyaltyReferralReward:     "premio_referidos",
  statusReservationApproved: "reserva_aprobada",
  statusReservationRejected: "reserva_no_disponible",
};

// ── Variable order per template type ─────────────────────────────────────────
// Each array lists the Meta named variables IN THE ORDER they appear in the
// default template body (matching MetaTemplateFormTab.tsx defaults).
// Position n+1 in Meta ({{1}}, {{2}}...) maps to variableOrder[n].

const VARIABLE_ORDER = {
  confirmacion_cita: [
    "nombre_cliente", "fecha_cita", "nombre_negocio", "direccion",
    "lista_servicios", "profesional", "enlace_cancelacion",
  ],
  citas_recurrentes: [
    "nombre_cliente", "nombre_negocio", "direccion",
    "profesional", "lista_citas", "enlace_cancelacion",
  ],
  recordatorio_cita: [
    "nombre_cliente", "cantidad_citas", "cita_o_citas", "agendada_o_agendadas",
    "fecha_cita", "nombre_negocio", "direccion",
    "lista_servicios", "profesional", "recomendaciones", "enlace_gestion",
  ],
  segundo_recordatorio: [
    "nombre_cliente", "fecha_cita", "nombre_negocio", "direccion",
    "lista_servicios", "profesional", "recomendaciones", "enlace_gestion",
  ],
  confirmacion_asistencia: ["nombre_cliente", "lista_citas"],
  aviso_cancelacion:       ["nombre_cliente", "lista_citas"],
  aviso_no_asistencia:     ["nombre_cliente", "servicio", "fecha_cita", "nombre_negocio"],
  premio_fidelidad:        ["nombre_cliente", "nombre_negocio", "premio"],
  premio_referidos:        ["nombre_cliente", "nombre_negocio", "premio"],
  reserva_aprobada:        ["nombre_cliente", "fecha_cita", "nombre_negocio", "direccion", "servicio", "enlace_cancelacion"],
  reserva_no_disponible:   ["nombre_cliente", "fecha_cita", "nombre_negocio"],
};

// ── Data key → Meta variable name ────────────────────────────────────────────

function buildMetaVarMap(data) {
  return {
    nombre_cliente:       data.names             ?? "",
    fecha_cita:           data.date ?? data.dateRange ?? data.date_range ?? "",
    nombre_negocio:       data.organization       ?? "",
    direccion:            data.address            ?? "",
    servicio:             data.service            ?? "",
    lista_servicios:      data.servicesList ?? data.services_list ?? "",
    profesional:          data.employee           ?? "",
    enlace_cancelacion:   data.cancellationLink   ?? "",
    enlace_gestion:       data.manage_block       ?? "",
    lista_citas:          data.appointments_list ?? data.appointmentsList ?? "",
    premio:               data.reward             ?? "",
    cantidad_citas:       String(data.count       ?? ""),
    cita_o_citas:         data.cita_pal           ?? "",
    agendada_o_agendadas: data.agendada_pal       ?? "",
    recomendaciones:      data.recommendations    ?? "",
  };
}

// ── Template status cache (5-min TTL per org) ────────────────────────────────

const templateCache = new Map(); // orgId → { templates: [], fetchedAt: ms }
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getApprovedTemplateList(org) {
  const key = org._id.toString();
  const cached = templateCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.templates;
  }
  const templates = await listTemplates(org);
  templateCache.set(key, { templates, fetchedAt: Date.now() });
  return templates;
}

export function invalidateTemplateCache(orgId) {
  templateCache.delete(orgId.toString());
}

// ── Component builder ────────────────────────────────────────────────────────

function buildComponents(metaTemplateName, data) {
  const order = VARIABLE_ORDER[metaTemplateName];
  if (!order || order.length === 0) return [];

  const varMap = buildMetaVarMap(data);
  const parameters = order.map((varName) => ({
    type: "text",
    text: String(varMap[varName] ?? ""),
  }));

  return [{ type: "body", parameters }];
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Sends a WhatsApp notification via an approved Meta template.
 * Returns null (and logs a warning) if the template is not found or not APPROVED.
 *
 * Template names are stored in Meta with an org-specific prefix (e.g. "abcd1234_confirmacion_cita").
 * listTemplates() returns them WITHOUT prefix (stripped), so we match by the base name.
 * sendTemplateMessage() receives the base name and adds the prefix internally.
 *
 * @param {Object} org          - Organization document (must have metaPhoneNumberId)
 * @param {string} phone        - Phone in E.164 format
 * @param {string} templateType - Internal template type (e.g. "scheduleAppointmentBatch")
 * @param {Object} data         - Variable data (same keys used for Baileys rendering)
 * @param {string} [language]   - BCP-47 language code, default "es"
 * @returns {Promise<Object|null>}
 */
export async function sendMetaTemplateNotification(org, phone, templateType, data, language = "es") {
  const metaName = META_TEMPLATE_NAMES[templateType];
  if (!metaName) {
    console.warn(`[metaSendWA] No Meta template name configured for type: ${templateType}`);
    return null;
  }

  let templates;
  try {
    templates = await getApprovedTemplateList(org);
  } catch (err) {
    console.error(`[metaSendWA] Could not fetch template list for org ${org._id}:`, err.message);
    return null;
  }

  // listTemplates returns names WITHOUT prefix — match by base name
  const template =
    templates.find((t) => t.name === metaName && t.language === language) ||
    templates.find((t) => t.name === metaName && t.language.startsWith(language.split("_")[0])) ||
    templates.find((t) => t.name === metaName);

  if (!template) {
    console.warn(`[metaSendWA] Template "${metaName}" not found for org ${org._id} (prefix: ${getOrgPrefix(org)})`);
    return null;
  }

  if (template.status !== "APPROVED") {
    console.warn(`[metaSendWA] Template "${metaName}" is not approved (status: ${template.status}) for org ${org._id}`);
    return null;
  }

  const components = buildComponents(metaName, data);
  const lang = template.language || language;

  try {
    // sendTemplateMessage adds the org prefix to metaName internally
    return await sendTemplateMessage(org, phone, metaName, lang, components);
  } catch (err) {
    const metaCode = err.response?.data?.error?.code;
    // 133010 = número no tiene WhatsApp — esperado, no es un error crítico
    if (metaCode === 133010) {
      console.warn(`[metaSendWA] ${phone} no tiene WhatsApp (133010) — omitiendo notificación`);
    } else {
      console.error(`[metaSendWA] Error sending template "${metaName}" to ${phone}:`, err.response?.data || err.message);
    }
    return null;
  }
}
