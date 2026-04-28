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

const extractText = (content) => {
  const block = content.find((b) => b.type === "text");
  return block?.text || "";
};

export const processBookingChat = async (organization, messages) => {
  const systemPrompt = buildBookingSystemPrompt(organization);
  const context = { organizationId: organization._id, organization };

  let currentMessages = [...messages];
  let bookingPayload = null;

  const toolsWithCache = bookingClaudeTools.map((t, i) =>
    i === bookingClaudeTools.length - 1
      ? { ...t, cache_control: { type: "ephemeral" } }
      : t
  );

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: toolsWithCache,
      messages: currentMessages,
    });

    if (response.stop_reason !== "tool_use") {
      const reply = extractText(response.content);
      return { reply, bookingPayload };
    }

    const toolUseBlocks = response.content.filter(
      (b) => b.type === "tool_use"
    );

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        let result;
        try {
          result = await executeBookingTool(block.name, block.input, context);
          // Capturar el payload cuando prepare_reservation devuelve éxito
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
    reply:
      "Lo siento, no pude completar el proceso. Por favor intenta de nuevo.",
    bookingPayload: null,
  };
};
