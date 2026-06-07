/**
 * metaTemplateService.js
 *
 * Gestión de plantillas Meta en el WABA único de AgenditApp.
 * Todas las orgs comparten el mismo WABA; los nombres de plantilla se prefiján
 * automáticamente con los últimos 8 chars del org ID para evitar colisiones.
 *
 * Ejemplo: template "confirmacion_cita" de org "...abcd1234" → "abcd1234_confirmacion_cita"
 * El prefijo es transparente para el frontend: se agrega al crear/enviar y se quita al listar.
 */

import axios from "axios";
import Organization from "../models/organizationModel.js";

const GRAPH_URL = "https://graph.facebook.com/v25.0";

function platformToken() {
  const token = process.env.META_SYSTEM_USER_TOKEN;
  if (!token) throw new Error("META_SYSTEM_USER_TOKEN no configurado.");
  return token;
}

function platformWabaId() {
  const wabaId = process.env.META_WABA_ID;
  if (!wabaId) throw new Error("META_WABA_ID no configurado.");
  return wabaId;
}


/** Prefijo único por org (8 últimos chars del ObjectID, siempre hex minúscula) */
export function getOrgPrefix(org) {
  return org._id.toString().slice(-8);
}

/** Agrega prefijo a un nombre de plantilla */
function prefixName(org, name) {
  return `${getOrgPrefix(org)}_${name}`;
}

/** Quita el prefijo de un nombre de plantilla (para mostrar al frontend) */
function stripPrefix(org, name) {
  const p = `${getOrgPrefix(org)}_`;
  return name.startsWith(p) ? name.slice(p.length) : name;
}

/** Valida que la org tiene Meta activo */
function assertMetaActive(org) {
  if (org.waConnectionType !== "meta" || !org.metaPhoneNumberId) {
    throw new Error("La organización no tiene Meta API configurada.");
  }
}

/**
 * Selecciona credenciales Meta según el modo de conexión de la org.
 *
 * Embedded Signup (org.metaWabaId presente):
 *   - Usa META_SYSTEM_USER_TOKEN (el system user fue agregado al WABA del cliente
 *     en connectOrgEmbedded, así el billing va a AgenditApp).
 *   - Fallback a org.metaAccessToken si el system user no se pudo agregar.
 *   - WABA es el del cliente → no necesita prefijo (aislado por WABA).
 *
 * SMS / WABA de plataforma:
 *   - Usa META_SYSTEM_USER_TOKEN + META_WABA_ID.
 *   - Requiere prefijo porque todas las orgs comparten el mismo WABA.
 */
function getOrgCredentials(org) {
  const systemToken = process.env.META_SYSTEM_USER_TOKEN;

  if (org.metaWabaId) {
    return {
      token: systemToken || org.metaAccessToken,
      wabaId: org.metaWabaId,
      usePrefix: false,
    };
  }

  return {
    token: systemToken,
    wabaId: platformWabaId(),
    usePrefix: true,
  };
}

/**
 * Lista las plantillas de la org.
 * - WABA propio (Embedded Signup): lista todas sin filtro de prefijo.
 * - WABA de plataforma: filtra por prefijo de org y devuelve nombres sin prefijo.
 */
export async function listTemplates(org) {
  assertMetaActive(org);
  const { token, wabaId, usePrefix } = getOrgCredentials(org);
  const client = axios.create({ baseURL: GRAPH_URL, params: { access_token: token } });
  const params = { fields: "id,name,status,category,language,components", limit: 100 };
  if (usePrefix) params.name_prefix = getOrgPrefix(org);
  const res = await client.get(`/${wabaId}/message_templates`, { params });
  const templates = res.data?.data || [];
  if (!usePrefix) return templates;
  return templates.map((t) => ({ ...t, name: stripPrefix(org, t.name) }));
}

/**
 * Crea un cliente axios para un token dado.
 */
function makeClient(token) {
  return axios.create({ baseURL: GRAPH_URL, params: { access_token: token } });
}

/**
 * Si la org tiene metaWabaId (Embedded Signup) y el token primario falla
 * con código 100 (permiso insuficiente del system user sobre el WABA del cliente),
 * reintenta con metaAccessToken (token del dueño del negocio, que siempre tiene admin).
 */
async function withOwnerTokenFallback(org, primaryToken, fn) {
  try {
    return await fn(primaryToken);
  } catch (err) {
    const isPermissionError = err.response?.data?.error?.code === 100;
    const hasOwnerToken = org.metaWabaId && org.metaAccessToken && org.metaAccessToken !== primaryToken;
    if (isPermissionError && hasOwnerToken) {
      console.warn("[metaTemplate] System user sin permisos de admin en el WABA del cliente — reintentando con metaAccessToken");
      return fn(org.metaAccessToken);
    }
    throw err;
  }
}

/**
 * Crea una plantilla (prefixa el nombre si usa WABA de plataforma).
 */
export async function createTemplate(org, template) {
  assertMetaActive(org);
  const { token, wabaId, usePrefix } = getOrgCredentials(org);
  const fullName = usePrefix ? prefixName(org, template.name) : template.name;
  const res = await withOwnerTokenFallback(org, token, (t) =>
    makeClient(t).post(`/${wabaId}/message_templates`, {
      name: fullName,
      category: template.category,
      language: template.language,
      components: template.components,
    })
  );
  return res.data;
}

/**
 * Edita los componentes de una plantilla existente (por ID, sin prefijo).
 */
export async function updateTemplate(org, templateId, components) {
  assertMetaActive(org);
  const { token } = getOrgCredentials(org);
  const res = await withOwnerTokenFallback(org, token, (t) =>
    makeClient(t).post(`/${templateId}`, { components })
  );
  return res.data;
}

/**
 * Elimina una plantilla por nombre (prefixa si aplica).
 */
export async function deleteTemplate(org, templateName) {
  assertMetaActive(org);
  const { token, wabaId, usePrefix } = getOrgCredentials(org);
  const fullName = usePrefix ? prefixName(org, templateName) : templateName;
  const res = await withOwnerTokenFallback(org, token, (t) =>
    makeClient(t).delete(`/${wabaId}/message_templates`, { params: { name: fullName } })
  );
  return res.data;
}

/**
 * Sincroniza el estado de aprobación de las plantillas.
 */
export async function syncTemplateStatus(org) {
  return listTemplates(org);
}

/**
 * Envía un mensaje usando una plantilla aprobada.
 * El templateName se recibe SIN prefijo; se agrega internamente si aplica.
 */
export async function sendTemplateMessage(org, toPhone, templateName, language, components = []) {
  if (!org.metaPhoneNumberId) throw new Error("La organización no tiene Meta API configurada.");
  const { token, usePrefix } = getOrgCredentials(org);
  const client = axios.create({ baseURL: GRAPH_URL, params: { access_token: token } });
  const fullName = usePrefix ? prefixName(org, templateName) : templateName;
  const res = await client.post(`/${org.metaPhoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to: toPhone,
    type: "template",
    template: { name: fullName, language: { code: language || "es" }, components },
  });
  return { messageId: res.data?.messages?.[0]?.id };
}

/**
 * Envía texto libre (solo dentro de ventana de 24h de conversación activa).
 */
export async function sendTextMessage(org, toPhone, text) {
  if (!org.metaPhoneNumberId) throw new Error("La organización no tiene Meta API configurada.");
  const { token } = getOrgCredentials(org);
  const client = axios.create({ baseURL: GRAPH_URL, params: { access_token: token } });
  try {
    const res = await client.post(`/${org.metaPhoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: toPhone,
      type: "text",
      text: { body: text },
    });
    return { messageId: res.data?.messages?.[0]?.id };
  } catch (err) {
    console.error("[metaSendText] Error:", JSON.stringify(err.response?.data));
    throw err;
  }
}
