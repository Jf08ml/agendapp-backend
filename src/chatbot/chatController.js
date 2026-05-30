import { processChat } from "./chatService.js";
import sendResponse from "../utils/sendResponse.js";
import ChatLog from "../models/chatLogModel.js";
import ChatbotFeedback from "../models/chatbotFeedbackModel.js";

function extractTextMessages(messages) {
  return messages
    .filter((m) => typeof m.content === "string" && ["user", "assistant"].includes(m.role))
    .map((m) => ({ role: m.role, content: m.content }));
}

export const chat = async (req, res) => {
  const { messages, sessionId } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return sendResponse(res, 400, null, "Se requiere un arreglo de mensajes.");
  }

  for (const msg of messages) {
    if (!["user", "assistant"].includes(msg.role) || !msg.content) {
      return sendResponse(res, 400, null, "Formato de mensajes inválido.");
    }
  }

  const startTime = Date.now();
  let result;

  try {
    result = await processChat(req.organization, req.user, messages);
  } catch (err) {
    if (sessionId) {
      ChatLog.findOneAndUpdate(
        { sessionId },
        {
          $setOnInsert: { organizationId: req.organization._id, type: "admin", userId: req.user?._id },
          $set: { error: err.message },
          $inc: { durationMs: Date.now() - startTime },
        },
        { upsert: true }
      ).catch(() => {});
    }
    return sendResponse(res, 500, null, "Error procesando el chat.");
  }

  const { reply, invalidates, _meta } = result;

  if (sessionId) {
    ChatLog.findOneAndUpdate(
      { sessionId },
      {
        $setOnInsert: { organizationId: req.organization._id, type: "admin", userId: req.user?._id },
        $set: {
          messages: extractTextMessages(messages),
          reply,
          hitRoundLimit: _meta.hitRoundLimit,
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

  return sendResponse(res, 200, { reply, invalidates });
};

export const submitFeedback = async (req, res) => {
  const { type, message, sessionId } = req.body;

  const VALID_TYPES = ["bug", "sugerencia", "comentario"];
  if (!VALID_TYPES.includes(type)) {
    return sendResponse(res, 400, null, "Tipo de feedback inválido.");
  }
  if (!message?.trim()) {
    return sendResponse(res, 400, null, "El mensaje es requerido.");
  }

  await ChatbotFeedback.create({
    organizationId: req.organization._id,
    userId: req.user?._id,
    type,
    message: message.trim(),
    sessionId: sessionId || undefined,
    agentName: req.organization.aiAssistantName || "Roxi",
  });

  return sendResponse(res, 201, null, "Feedback recibido. ¡Gracias!");
};
