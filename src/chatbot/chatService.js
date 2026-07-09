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

// Tools de creación/asignación cuyo éxito el modelo podría afirmar sin haberlas
// llamado realmente (o ignorando que el resultado real fue un error/duplicado).
const MUTATION_TOOLS = new Set([
  "create_service",
  "bulk_create_services",
  "create_employee",
  "assign_services_to_employee",
]);

// Detecta cuando la respuesta afirma que se creó/agregó/asignó/registró un
// servicio o profesional (en cualquier orden de palabras y cualquier conjugación).
const ACTION_STEM = "(cre\\w*|agreg\\w*|asign\\w*|registr\\w*)";
const ENTITY_NOUN = "(servicio|profesional|empleado)s?";
const CRUD_CLAIM_PATTERN = new RegExp(
  `\\b${ENTITY_NOUN}\\b.{0,120}\\b${ACTION_STEM}\\b|\\b${ACTION_STEM}\\b.{0,120}\\b${ENTITY_NOUN}\\b`,
  "i"
);

// Detecta si el ÚLTIMO mensaje de texto del usuario pidió crear/agregar/asignar
// algo — para no disparar el guard cuando el usuario solo está preguntando por
// algo ya creado en un turno anterior (ej: "¿ya quedó el servicio?").
const CREATION_INTENT_PATTERN =
  /\b(crea|crear|creame|créame|cream[eo]s|agrega|agregar|agrégame|añad[ei]|asigna|asignar|asígnale|asígname|registra|registrar|dame de alta|da de alta|suma|sumar)\b/i;

const findLastUserText = (messages) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
};

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
      // Fallback: si el modelo terminó el turno sin bloque de texto (puede pasar en
      // sesiones largas con muchas tool calls seguidas), nunca devolver un reply vacío.
      const reply =
        extractText(response.content) ||
        "Listo, ya quedó registrado. ¿Hay algo más en lo que te pueda ayudar?";

      // Guard: el bot afirma que creó/agregó/asignó un servicio o profesional pero
      // nunca llamó la herramienta correspondiente en esta conversación, Y el
      // usuario sí pidió esa acción en su último mensaje (para no disparar esto
      // cuando solo está preguntando por algo creado en un turno anterior).
      const calledMutationTool = [...executedTools].some((t) => MUTATION_TOOLS.has(t));
      if (
        !calledMutationTool &&
        CRUD_CLAIM_PATTERN.test(reply) &&
        CREATION_INTENT_PATTERN.test(findLastUserText(currentMessages)) &&
        round < MAX_TOOL_ROUNDS - 1
      ) {
        currentMessages = [
          ...currentMessages,
          { role: "assistant", content: response.content },
          {
            role: "user",
            content:
              "[SISTEMA] No llamaste ninguna herramienta de creación/asignación (create_service, bulk_create_services, create_employee o assign_services_to_employee) todavía. Debes llamarla AHORA con los datos reales antes de confirmar esto. Si la herramienta devuelve success: false, duplicateWarning o priceWarning, o algún item en 'failed', informa ese resultado real al usuario — no digas que se creó/asignó si no fue así.",
          },
        ];
        continue;
      }

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
