import Anthropic from "@anthropic-ai/sdk";
import { buildBookingSystemPrompt } from "./bookingSystemPrompt.js";
import {
  bookingClaudeTools,
  executeBookingTool,
} from "./bookingToolRegistry.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;
const MAX_TOOL_ROUNDS = 8;

// Detecta cuando el bot afirma que la reserva fue confirmada/procesada sin haber
// llamado prepare_reservation. Cubre "reserva confirmada", tiempo pasado del verbo
// ("reservé", "agendé") y el mensaje del botón que solo debe decirse DESPUÉS de la tool.
const BOOKING_HALLUCINATION_PATTERN =
  /\b(reserva|turno|cita)\b.{0,150}\b(confirmad[ao]|procesad[ao]|cread[ao]|agendad[ao]|registrad[ao]|complet[ao]|exitosa|realizada)\b|\bbotón\b.{0,80}\b(confirmar|verificar)\b|haz clic.{0,60}(confirmar|s[ií])|\b(reservé|agendé|confirmé)\b/i;

const extractText = (content) => {
  const block = content.find((b) => b.type === "text");
  return block?.text || "";
};

export const processBookingChat = async (organization, messages) => {
  const systemPrompt = buildBookingSystemPrompt(organization);
  const context = { organizationId: organization._id, organization };

  let currentMessages = [...messages];
  let bookingPayload = null;
  const executedTools = new Set();
  let inputTokens = 0;
  let outputTokens = 0;
  let rounds = 0;

  const toolsWithCache = bookingClaudeTools.map((t, i) =>
    i === bookingClaudeTools.length - 1
      ? { ...t, cache_control: { type: "ephemeral" } }
      : t
  );

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    rounds = round + 1;
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      tools: toolsWithCache,
      messages: currentMessages,
    });

    inputTokens += response.usage?.input_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;

    if (response.stop_reason !== "tool_use") {
      // Fallback: si prepare_reservation ya fue llamada pero el reply quedó vacío
      // (el modelo generó el mensaje del botón en la misma ronda que la tool call),
      // inyectar mensaje genérico de confirmación.
      const rawReply = extractText(response.content);
      const reply =
        rawReply ||
        (bookingPayload !== null
          ? "¡Listo! Toca el botón **'Sí, confirmar'** para finalizar tu reserva."
          : "");

      // Guard: el bot dice que la reserva fue confirmada sin haber llamado
      // prepare_reservation. Inyecta una corrección y continúa el loop.
      if (
        bookingPayload === null &&
        BOOKING_HALLUCINATION_PATTERN.test(reply) &&
        round < MAX_TOOL_ROUNDS - 1
      ) {
        currentMessages = [
          ...currentMessages,
          { role: "assistant", content: response.content },
          {
            role: "user",
            content:
              "[SISTEMA] Aún no llamaste prepare_reservation. Debes llamarla AHORA con todos los datos recopilados antes de dar esa respuesta al cliente.",
          },
        ];
        continue;
      }

      return {
        reply,
        bookingPayload,
        _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: false },
      };
    }

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        executedTools.add(block.name);
        let result;
        try {
          result = await executeBookingTool(block.name, block.input, context);
          if (block.name === "prepare_reservation" && result?.success) {
            bookingPayload = result.payload;
          }
        } catch (err) {
          result = { success: false, error: err.message };
        }
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        };
      })
    );

    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: response.content },
      { role: "user", content: toolResults },
    ];
  }

  return {
    reply: "Lo siento, no pude completar el proceso. Por favor intenta de nuevo.",
    bookingPayload: null,
    _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: true },
  };
};
