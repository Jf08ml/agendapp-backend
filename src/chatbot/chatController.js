import { processChat } from "./chatService.js";
import sendResponse from "../utils/sendResponse.js";

export const chat = async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return sendResponse(res, 400, null, "Se requiere un arreglo de mensajes.");
  }

  // Validar formato básico de mensajes
  for (const msg of messages) {
    if (!["user", "assistant"].includes(msg.role) || !msg.content) {
      return sendResponse(res, 400, null, "Formato de mensajes inválido.");
    }
  }

  const { reply, invalidates } = await processChat(req.organization, req.user, messages);
  return sendResponse(res, 200, { reply, invalidates });
};
