import axios from "axios";
import Organization from "../models/organizationModel.js";

const GRAPH_URL = "https://graph.facebook.com/v25.0";

function graphClient(accessToken) {
  return axios.create({
    baseURL: GRAPH_URL,
    params: { access_token: accessToken },
  });
}

function getOrgMeta(org) {
  if (!org.metaWabaId || !org.metaAccessToken) {
    throw new Error("La organización no tiene Meta API configurada.");
  }
  return { wabaId: org.metaWabaId, token: org.metaAccessToken };
}

/**
 * Lista todas las plantillas del WABA de la org.
 */
export async function listTemplates(org) {
  const { wabaId, token } = getOrgMeta(org);
  const client = graphClient(token);
  const res = await client.get(`/${wabaId}/message_templates`, {
    params: {
      fields: "id,name,status,category,language,components",
      limit: 100,
    },
  });
  return res.data?.data || [];
}

/**
 * Crea una plantilla en Meta y devuelve el resultado.
 * @param {Object} org
 * @param {Object} template
 * @param {string} template.name          - Nombre único en minúsculas y guiones bajos
 * @param {string} template.category      - UTILITY | MARKETING | AUTHENTICATION
 * @param {string} template.language      - es | en_US | pt_BR etc.
 * @param {Array}  template.components    - Array de componentes (HEADER, BODY, FOOTER, BUTTONS)
 */
export async function createTemplate(org, template) {
  const { wabaId, token } = getOrgMeta(org);
  const client = graphClient(token);
  const res = await client.post(`/${wabaId}/message_templates`, {
    name: template.name,
    category: template.category,
    language: template.language,
    components: template.components,
  });
  return res.data; // { id, status }
}

/**
 * Edita una plantilla existente (solo se puede editar el contenido, no nombre/categoría).
 */
export async function updateTemplate(org, templateId, components) {
  const { token } = getOrgMeta(org);
  const client = graphClient(token);
  const res = await client.post(`/${templateId}`, { components });
  return res.data;
}

/**
 * Elimina una plantilla.
 */
export async function deleteTemplate(org, templateName) {
  const { wabaId, token } = getOrgMeta(org);
  const client = graphClient(token);
  const res = await client.delete(`/${wabaId}/message_templates`, {
    params: { name: templateName },
  });
  return res.data;
}

/**
 * Sincroniza el estado de aprobación de las plantillas desde Meta.
 * Devuelve el listado actualizado.
 */
export async function syncTemplateStatus(org) {
  return listTemplates(org);
}

/**
 * Envía un mensaje usando una plantilla aprobada de Meta.
 * @param {Object} org
 * @param {string} toPhone  - E.164
 * @param {string} templateName
 * @param {string} language - es | en_US etc.
 * @param {Array}  components - componentes con parámetros variables
 */
export async function sendTemplateMessage(org, toPhone, templateName, language, components = []) {
  if (!org.metaPhoneNumberId || !org.metaAccessToken) {
    throw new Error("La organización no tiene Meta API configurada.");
  }
  const client = graphClient(org.metaAccessToken);
  const res = await client.post(`/${org.metaPhoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to: toPhone,
    type: "template",
    template: {
      name: templateName,
      language: { code: language || "es" },
      components,
    },
  });
  return { messageId: res.data?.messages?.[0]?.id };
}

/**
 * Envía un mensaje de texto libre (solo permitido en ventana de 24h de conversación activa).
 */
export async function sendTextMessage(org, toPhone, text) {
  if (!org.metaPhoneNumberId || !org.metaAccessToken) {
    throw new Error("La organización no tiene Meta API configurada.");
  }
  const client = graphClient(org.metaAccessToken);
  const res = await client.post(`/${org.metaPhoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to: toPhone,
    type: "text",
    text: { body: text },
  });
  return { messageId: res.data?.messages?.[0]?.id };
}
