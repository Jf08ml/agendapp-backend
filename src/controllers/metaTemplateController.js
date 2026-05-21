import { listTemplates, createTemplate, updateTemplate, deleteTemplate, syncTemplateStatus } from "../services/metaTemplateService.js";
import Organization from "../models/organizationModel.js";
import sendResponse from "../utils/sendResponse.js";

async function getOrg(orgId) {
  const org = await Organization.findById(orgId).lean();
  if (!org) throw new Error("Organización no encontrada");
  if (org.waConnectionType !== "meta") throw new Error("La organización no tiene Meta API configurada.");
  return org;
}

export async function handleListTemplates(req, res) {
  try {
    const org = await getOrg(req.params.id);
    const templates = await listTemplates(org);
    sendResponse(res, 200, templates);
  } catch (err) {
    sendResponse(res, 400, null, err.message);
  }
}

export async function handleCreateTemplate(req, res) {
  try {
    const org = await getOrg(req.params.id);
    const result = await createTemplate(org, req.body);
    sendResponse(res, 201, result, "Plantilla enviada a revisión de Meta");
  } catch (err) {
    console.error("[metaTemplate] Error creando:", err.response?.data || err.message);
    sendResponse(res, 400, null, err.response?.data?.error?.message || err.message);
  }
}

export async function handleUpdateTemplate(req, res) {
  try {
    const org = await getOrg(req.params.id);
    const result = await updateTemplate(org, req.params.templateId, req.body.components);
    sendResponse(res, 200, result, "Plantilla actualizada");
  } catch (err) {
    sendResponse(res, 400, null, err.response?.data?.error?.message || err.message);
  }
}

export async function handleDeleteTemplate(req, res) {
  try {
    const org = await getOrg(req.params.id);
    await deleteTemplate(org, req.params.templateName);
    sendResponse(res, 200, null, "Plantilla eliminada");
  } catch (err) {
    sendResponse(res, 400, null, err.message);
  }
}

export async function handleSyncTemplates(req, res) {
  try {
    const org = await getOrg(req.params.id);
    const templates = await syncTemplateStatus(org);
    sendResponse(res, 200, templates, "Plantillas sincronizadas con Meta");
  } catch (err) {
    sendResponse(res, 400, null, err.message);
  }
}
