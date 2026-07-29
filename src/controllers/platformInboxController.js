import sendResponse from "../utils/sendResponse.js";
import {
  listConversations,
  getConversationMessages,
  markConversationRead,
  replyToConversation,
} from "../services/platformInboxService.js";

export async function getConversations(req, res) {
  try {
    const conversations = await listConversations();
    sendResponse(res, 200, conversations);
  } catch (err) {
    console.error("[platformInbox] getConversations error:", err);
    sendResponse(res, 500, null, "Error al listar conversaciones");
  }
}

export async function getMessages(req, res) {
  try {
    const messages = await getConversationMessages(req.params.phone);
    sendResponse(res, 200, messages);
  } catch (err) {
    console.error("[platformInbox] getMessages error:", err);
    sendResponse(res, 500, null, "Error al obtener los mensajes");
  }
}

export async function markRead(req, res) {
  try {
    await markConversationRead(req.params.phone);
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
