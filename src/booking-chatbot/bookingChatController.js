import { processBookingChat } from "./bookingChatService.js";
import sendResponse from "../utils/sendResponse.js";
import ChatLog from "../models/chatLogModel.js";
import ChatbotFeedback from "../models/chatbotFeedbackModel.js";

function extractTextMessages(messages) {
  return messages
    .filter((m) => typeof m.content === "string" && ["user", "assistant"].includes(m.role))
    .map((m) => ({ role: m.role, content: m.content }));
}

export const bookingChat = async (req, res) => {
  const { messages, sessionId } = req.body;

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

  const startTime = Date.now();
  let result;

  try {
    result = await processBookingChat(req.organization, messages);
  } catch (err) {
    if (sessionId) {
      ChatLog.findOneAndUpdate(
        { sessionId },
        {
          $setOnInsert: { organizationId: req.organization._id, type: "booking" },
          $set: { error: err.message },
          $inc: { durationMs: Date.now() - startTime },
        },
        { upsert: true }
      ).catch(() => {});
    }
    return sendResponse(res, 500, null, "Error procesando el chat.");
  }

  const { reply, bookingPayload, _meta } = result;

  if (sessionId) {
    ChatLog.findOneAndUpdate(
      { sessionId },
      {
        $setOnInsert: { organizationId: req.organization._id, type: "booking" },
        $set: {
          messages: extractTextMessages(messages),
          reply,
          hitRoundLimit: _meta.hitRoundLimit,
          ...(bookingPayload ? { bookingPayload } : {}),
        },
        $inc: {
          rounds: _meta.rounds,
          inputTokens: _meta.inputTokens,
          outputTokens: _meta.outputTokens,
          durationMs: Date.now() - startTime,
        },
        $addToSet: { toolsUsed: { $each: _meta.toolsUsed } },
      },
      { upsert: true }
    ).catch(() => {});
  }

  return sendResponse(res, 200, { reply, bookingPayload });
};

// POST /booking-chat/feedback — público (solo organizationResolver)
export const submitBookingFeedback = async (req, res) => {
  const { rating, message, sessionId } = req.body;

  if (!rating || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return sendResponse(res, 400, null, "Calificación inválida. Debe ser un número entre 1 y 5.");
  }

  await ChatbotFeedback.create({
    organizationId: req.organization._id,
    source: "booking",
    type: "satisfaccion",
    rating,
    message: message?.trim() || undefined,
    sessionId: sessionId || undefined,
    agentName: req.organization.aiAssistantName || "Roxi",
  });

  return sendResponse(res, 201, null, "¡Gracias por tu opinión!");
};
