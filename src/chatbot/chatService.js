import Anthropic from "@anthropic-ai/sdk";
import moment from "moment-timezone";
import { buildSystemPrompt } from "./systemPrompt.js";
import { claudeTools, executeTool } from "./toolRegistry.js";
import Service from "../models/serviceModel.js";
import Employee from "../models/employeeModel.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 4096;
const MAX_TOOL_ROUNDS = 8;

const buildContext = async (organization, user) => {
  const [servicesCount, employeesCount] = await Promise.all([
    Service.countDocuments({ organizationId: organization._id, isActive: true }),
    Employee.countDocuments({ organizationId: organization._id, isActive: true }),
  ]);

  return {
    organizationId: organization._id,
    organization,
    user,
    currentDate: moment.tz(organization.timezone || "America/Bogota").format("YYYY-MM-DD"),
    setupStatus: {
      servicesCount,
      employeesCount,
      setupCompleted: organization.setupCompleted || false,
    },
  };
};

const extractText = (content) => {
  const block = content.find((b) => b.type === "text");
  return block?.text || "";
};

// Tools que modifican la org → el frontend debe refrescar el store de organización
const ORG_INVALIDATING_TOOLS = new Set([
  "update_booking_config",
  "update_schedule",
  "update_primary_color",
  "mark_setup_complete",
]);

export const processChat = async (organization, user, messages) => {
  const context = await buildContext(organization, user);
  const systemPrompt = buildSystemPrompt(context);

  let currentMessages = [...messages];
  const executedTools = new Set();
  let inputTokens = 0;
  let outputTokens = 0;
  let rounds = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    rounds = round + 1;
    const toolsWithCache = claudeTools.map((t, i) =>
      i === claudeTools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t
    );

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
      const reply = extractText(response.content);
      const invalidates = [...executedTools].some((t) => ORG_INVALIDATING_TOOLS.has(t))
        ? ["organization"]
        : [];
      return {
        reply,
        invalidates,
        _meta: { rounds, toolsUsed: [...executedTools], inputTokens, outputTokens, hitRoundLimit: false },
      };
    }

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        executedTools.add(block.name);
        let result;
        try {
          result = await executeTool(block.name, block.input, context);
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

  const usedTools = [...executedTools];
  const manualHint = usedTools.includes("create_appointments")
    ? " Para crear la cita manualmente ve a Gestionar Agenda y usa el botón 'Crear cita'."
    : usedTools.includes("cancel_or_delete_appointment")
    ? " Para cancelar o eliminar la cita ve a Gestionar Agenda, haz clic sobre la cita y usa el menú de acciones."
    : "";

  return {
    reply: `No pude completar la operación en el tiempo disponible.${manualHint} Por favor intenta de nuevo con una solicitud más específica o realízalo directamente desde la interfaz.`,
    invalidates: [],
    _meta: { rounds, toolsUsed: usedTools, inputTokens, outputTokens, hitRoundLimit: true },
  };
};
