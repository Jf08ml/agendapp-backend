import { listTemplates, createTemplate, updateTemplate, deleteTemplate, syncTemplateStatus } from "../services/metaTemplateService.js";
import Organization from "../models/organizationModel.js";
import WhatsappTemplate from "../models/whatsappTemplateModel.js";
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
    const templateDoc = await WhatsappTemplate.findOne({ organizationId: org._id }).lean();
    // .lean() devuelve los campos Map como objeto plano, no como Map real.
    const drafts = templateDoc?.metaTemplateDrafts || {};
    sendResponse(res, 200, { templates, drafts });
  } catch (err) {
    sendResponse(res, 400, null, err.message);
  }
}

export async function handleCreateTemplate(req, res) {
  try {
    const org = await getOrg(req.params.id);
    const { namedDraft, bodyVariableOrder, ...metaPayload } = req.body;
    const result = await createTemplate(org, metaPayload);

    // Se indexa por el NOMBRE real de la plantilla en Meta (ej. "confirmacion_cita"),
    // no por el templateKey del editor — un mismo nombre de plantilla puede
    // servir a más de un templateType (scheduleAppointment y
    // scheduleAppointmentBatch comparten "confirmacion_cita"), así que indexar
    // por templateKey dejaría sin borrador guardado a la mitad de los envíos.
    if (metaPayload.name) {
      await WhatsappTemplate.findOneAndUpdate(
        { organizationId: org._id },
        {
          $set: {
            [`metaTemplateDrafts.${metaPayload.name}`]: {
              headerText: namedDraft?.headerText || "",
              bodyText: namedDraft?.bodyText || "",
              footerText: namedDraft?.footerText || "",
              category: metaPayload.category,
              language: metaPayload.language,
              bodyVariableOrder: bodyVariableOrder || [],
            },
          },
        },
        { upsert: true }
      );
    }

    sendResponse(res, 201, result, "Plantilla enviada a revisión de Meta");
  } catch (err) {
    console.error("[metaTemplate] Error creando:", err.response?.data || err.message);
    const metaError = err.response?.data?.error;
    const isRateLimit = metaError?.code === 80008;

    let extraData = null;
    if (isRateLimit) {
      try {
        const usageHeader = err.response?.headers?.["x-business-use-case-usage"];
        if (usageHeader) {
          const usage = JSON.parse(usageHeader);
          const entries = Object.values(usage)[0];
          if (Array.isArray(entries) && entries[0]?.estimated_time_to_regain_access != null) {
            extraData = { rateLimitMinutes: entries[0].estimated_time_to_regain_access };
          }
        }
      } catch { /* ignore header parse errors */ }
    }

    const userMsg = metaError?.error_user_msg || metaError?.message || err.message;
    sendResponse(res, 400, extraData, userMsg);
  }
}

export async function handleUpdateTemplate(req, res) {
  try {
    const org = await getOrg(req.params.id);
    const { metaTemplateName, namedDraft, bodyVariableOrder, category, language, components } = req.body;
    const result = await updateTemplate(org, req.params.templateId, components);

    // Mismo criterio que handleCreateTemplate: se indexa por el nombre real
    // de la plantilla en Meta, no por el templateKey del editor.
    if (metaTemplateName) {
      await WhatsappTemplate.findOneAndUpdate(
        { organizationId: org._id },
        {
          $set: {
            [`metaTemplateDrafts.${metaTemplateName}`]: {
              headerText: namedDraft?.headerText || "",
              bodyText: namedDraft?.bodyText || "",
              footerText: namedDraft?.footerText || "",
              category: category || "UTILITY",
              language: language || "es",
              bodyVariableOrder: bodyVariableOrder || [],
            },
          },
        },
        { upsert: true }
      );
    }

    sendResponse(res, 200, result, "Plantilla actualizada — Meta la revisará de nuevo");
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
    console.error("[metaTemplate] Error eliminando:", err.response?.data || err.message);
    const metaError = err.response?.data?.error;
    const userMsg = metaError?.error_user_msg || metaError?.message || err.message;
    sendResponse(res, 400, null, userMsg);
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
