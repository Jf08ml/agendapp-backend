import { processBookingChat } from "./bookingChatService.js";
import { MAX_ACTION_LOG } from "./actionLog.js";
import sendResponse from "../utils/sendResponse.js";
import ChatLog from "../models/chatLogModel.js";
import ChatbotFeedback from "../models/chatbotFeedbackModel.js";
import {
  transcribeAudio,
  VOICE_NOTE_PREFIX,
  VOICE_NOTE_FAILED,
  VOICE_FAIL_REPLY,
} from "../services/audioTranscriptionService.js";

// Adjunto del último mensaje (chat web): foto o nota de voz grabada en el
// navegador, en base64. El body tiene límite de 5 MB; el frontend comprime las
// fotos y corta los audios a 2 min, así que estos topes casi nunca se tocan.
const MAX_WEB_IMAGE_BYTES = 3.5 * 1024 * 1024;
const MAX_WEB_AUDIO_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const IMAGE_PREFIX = "📷 (imagen)";

// Valida el adjunto y devuelve { images?, userContent, voiceFailed } o { error }.
async function resolveAttachment(attachment, lastText) {
  const type = attachment?.type;
  const mimeType = String(attachment?.mimeType || "").split(";")[0].trim().toLowerCase();
  if (!["image", "audio"].includes(type) || typeof attachment?.data !== "string") {
    return { error: "Adjunto inválido." };
  }
  const buffer = Buffer.from(attachment.data, "base64");
  if (!buffer.length) return { error: "Adjunto vacío." };

  if (type === "image") {
    if (!IMAGE_TYPES.has(mimeType)) return { error: "Formato de imagen no soportado." };
    if (buffer.length > MAX_WEB_IMAGE_BYTES) return { error: "La imagen es demasiado grande." };
    const caption = String(lastText || "").replace(IMAGE_PREFIX, "").trim();
    return {
      images: [{ mediaType: mimeType, data: attachment.data }],
      userContent: `${IMAGE_PREFIX}${caption ? ` ${caption}` : ""}`,
    };
  }

  if (!mimeType.startsWith("audio/")) return { error: "Formato de audio no soportado." };
  if (buffer.length > MAX_WEB_AUDIO_BYTES) return { error: "La nota de voz es demasiado larga." };
  const transcript = await transcribeAudio(buffer, mimeType);
  return transcript
    ? { userContent: `${VOICE_NOTE_PREFIX} ${transcript}` }
    : { userContent: VOICE_NOTE_FAILED, voiceFailed: true };
}

function extractTextMessages(messages) {
  return messages
    .filter((m) => typeof m.content === "string" && ["user", "assistant"].includes(m.role))
    .map((m) => ({ role: m.role, content: m.content }));
}

export const bookingChat = async (req, res) => {
  const { sessionId, attachment } = req.body;
  let { messages } = req.body;

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

  // Foto o nota de voz del último mensaje: la foto va a Claude solo en este turno
  // y la nota de voz se transcribe; en el historial quedan como texto marcado
  // (igual que en WhatsApp). userContent vuelve al frontend para la burbuja.
  let images;
  let userContent = null;
  let voiceFailed = false;
  if (attachment) {
    const last = messages[messages.length - 1];
    if (last.role !== "user") {
      return sendResponse(res, 400, null, "El adjunto debe ir en un mensaje del cliente.");
    }
    const resolved = await resolveAttachment(attachment, last.content);
    if (resolved.error) return sendResponse(res, 400, null, resolved.error);
    ({ images, userContent } = resolved);
    voiceFailed = !!resolved.voiceFailed;
    messages = [...messages.slice(0, -1), { role: "user", content: userContent }];
  }

  let result;

  // Acciones de turnos anteriores de esta misma conversación (ver actionLog.js)
  let actionLog = [];
  if (sessionId) {
    const prev = await ChatLog.findOne(
      { sessionId, organizationId: req.organization._id },
      { actionLog: 1 }
    ).lean().catch(() => null);
    actionLog = prev?.actionLog || [];
  }

  try {
    result = voiceFailed
      ? // Sin transcripción no hay qué mandarle al modelo: respuesta fija.
        {
          reply: VOICE_FAIL_REPLY,
          bookingPayload: null,
          _meta: { rounds: 0, inputTokens: 0, outputTokens: 0, toolsUsed: [], hitRoundLimit: false },
        }
      : await processBookingChat(req.organization, messages, { actionLog, images });
  } catch (err) {
    if (sessionId) {
      ChatLog.findOneAndUpdate(
        { sessionId },
        {
          $setOnInsert: {
            organizationId: req.organization._id,
            type: "booking",
            "review.reviewed": false,
          },
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
        $setOnInsert: { organizationId: req.organization._id, type: "booking", "review.reviewed": false },
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
          cacheReadTokens: _meta.cacheReadTokens || 0,
          cacheWriteTokens: _meta.cacheWriteTokens || 0,
          durationMs: Date.now() - startTime,
        },
        $addToSet: { toolsUsed: { $each: _meta.toolsUsed } },
        ...(_meta.toolErrors?.length || _meta.actions?.length
          ? {
              $push: {
                ...(_meta.toolErrors?.length ? { toolErrors: { $each: _meta.toolErrors, $slice: -50 } } : {}),
                ...(_meta.actions?.length ? { actionLog: { $each: _meta.actions, $slice: -MAX_ACTION_LOG } } : {}),
              },
            }
          : {}),
      },
      { upsert: true }
    ).catch(() => {});
  }

  return sendResponse(res, 200, { reply, bookingPayload, userContent });
};

// POST /booking-chat/converted — público (solo organizationResolver)
// El frontend lo llama tras crear la reserva con éxito (clic en "Sí, confirmar").
// Marca la sesión como convertida para medir la tasa prepare_reservation → reserva real.
export const markBookingConverted = async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId || typeof sessionId !== "string") {
    return sendResponse(res, 400, null, "sessionId es requerido.");
  }

  const updated = await ChatLog.findOneAndUpdate(
    { sessionId, organizationId: req.organization._id, type: "booking" },
    { $set: { reservationCreated: true, reservationCreatedAt: new Date() } },
    { new: true }
  ).catch(() => null);

  if (!updated) {
    return sendResponse(res, 404, null, "Sesión no encontrada.");
  }
  return sendResponse(res, 200, null, "Conversión registrada.");
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
