import { processBookingChat } from "./bookingChatService.js";
import sendResponse from "../utils/sendResponse.js";

export const bookingChat = async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return sendResponse(res, 400, null, "Se requiere un arreglo de mensajes.");
  }

  for (const msg of messages) {
    if (!["user", "assistant"].includes(msg.role) || !msg.content) {
      return sendResponse(res, 400, null, "Formato de mensajes inválido.");
    }
  }

  if (!req.organization) {
    return sendResponse(res, 404, null, "Organización no encontrada.");
  }

  const { reply, bookingPayload } = await processBookingChat(
    req.organization,
    messages
  );

  return sendResponse(res, 200, { reply, bookingPayload });
};
