import sendResponse from "../utils/sendResponse.js";
import {
  listConversations,
  getConversationMessages,
  markConversationRead,
  replyToConversation,
} from "../services/platformInboxService.js";
import { getPlatformSettings, updatePlatformSettings } from "../services/platformSettingsService.js";
import { isOficinaLineConfigured } from "../services/metaApiService.js";

// Interruptores de los envíos automáticos por el número de plataforma
// (retargeting y aviso de desconexión de WhatsApp).
export async function getSettings(req, res) {
  const settings = await getPlatformSettings();
  sendResponse(res, 200, settings);
}

export async function patchSettings(req, res) {
  try {
    const settings = await updatePlatformSettings(req.body);
    if (!settings) {
      return sendResponse(res, 400, null, "No se envió ninguna configuración válida");
    }
    sendResponse(res, 200, settings);
  } catch (err) {
    console.error("[platformInbox] patchSettings error:", err);
    sendResponse(res, 500, null, "Error al guardar la configuración");
  }
}

// Números de AgenditApp con inbox: el oficial y, si está configurado, el de soporte
// y ventas que opera AgenditApp Oficina IA. Cada ruta de conversaciones recibe
// ?line=platform|oficina (por defecto, el oficial).
export function getLines(req, res) {
  sendResponse(res, 200, [
    { id: "platform", configured: true },
    { id: "oficina", configured: isOficinaLineConfigured() },
  ]);
}

export async function getConversations(req, res) {
  try {
    const conversations = await listConversations(req.query.line);
    sendResponse(res, 200, conversations);
  } catch (err) {
    console.error("[platformInbox] getConversations error:", err);
    sendResponse(res, 500, null, "Error al listar conversaciones");
  }
}

export async function getMessages(req, res) {
  try {
    const messages = await getConversationMessages(req.params.phone, req.query.line);
    sendResponse(res, 200, messages);
  } catch (err) {
    console.error("[platformInbox] getMessages error:", err);
    sendResponse(res, 500, null, "Error al obtener los mensajes");
  }
}

export async function markRead(req, res) {
  try {
    await markConversationRead(req.params.phone, req.query.line);
    sendResponse(res, 200, { ok: true });
  } catch (err) {
    console.error("[platformInbox] markRead error:", err);
    sendResponse(res, 500, null, "Error al marcar como leído");
  }
}

export async function postReply(req, res) {
  try {
    const body = req.body?.body?.trim();
    if (!body) {
      return sendResponse(res, 400, null, "El mensaje no puede estar vacío");
    }

    const message = await replyToConversation({
      phone: req.params.phone,
      body,
      adminId: req.user.adminId,
      line: req.query.line,
    });
    sendResponse(res, 201, message);
  } catch (err) {
    console.error("[platformInbox] postReply error:", err.response?.data || err.message);
    sendResponse(
      res,
      500,
      null,
      err.response?.data?.error?.message || "Error al enviar la respuesta por WhatsApp"
    );
  }
}
