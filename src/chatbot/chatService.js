import Anthropic from "@anthropic-ai/sdk";
import moment from "moment-timezone";
import { buildSystemPrompt } from "./systemPrompt.js";
import { claudeTools, executeTool } from "./toolRegistry.js";
import Service from "../models/serviceModel.js";
import Employee from "../models/employeeModel.js";
import Organization from "../models/organizationModel.js";
import { markOnboardingMilestone } from "../utils/onboardingMilestones.js";

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

// Claims de configuración afirmados en pasado sin haber llamado la tool:
// "✅ Aprobación automática configurada", "la política de reserva quedó..." —
// caso real observado en logs de onboarding (la org quedó en manual creyendo
// que era automática). El patrón es estrecho a propósito: la pregunta del PASO 4
// ("¿quieres aprobarla manualmente o que se confirme automáticamente?") no matchea.
const POLICY_CLAIM_PATTERN =
  /\b(aprobaci[oó]n|pol[ií]tica)\b.{0,60}\b(configurad|activad|establecid|guardad|qued[oó]|list[ao]\b)/i;

// "¡Configuración inicial completada!" / "tu negocio ya está configurado" sin
// mark_setup_complete — deja al usuario atrapado rebotando al wizard.
const SETUP_DONE_CLAIM_PATTERN =
  /\bconfiguraci[oó]n\b.{0,60}\b(complet|finaliz|list[ao]\b)|\b(ya\s+est[aá]|qued[oó])\s+configurad/i;

const findLastUserText = (messages) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
};

// Cierre determinista del onboarding: si los criterios reales ya se cumplen
// (≥1 servicio, ≥1 profesional, horario habilitado), marca setupCompleted +
// milestone del funnel SIN depender de que el modelo llame mark_setup_complete
// (en producción el modelo lo olvida con frecuencia y la org queda atrapada
// rebotando al wizard). Se consulta estado FRESCO — las tools de este turno
// pudieron haber creado servicios/horario después de construirse el context.
// Devuelve true si completó el setup en esta llamada.
const autoCompleteSetupIfReady = async (organizationId) => {
  try {
    const [servicesCount, employeesCount, org] = await Promise.all([
      Service.countDocuments({ organizationId, isActive: true }),
      Employee.countDocuments({ organizationId, isActive: true }),
      Organization.findById(organizationId).select("setupCompleted weeklySchedule").lean(),
    ]);
    if (!org || org.setupCompleted) return false;
    const hasSchedule = !!(org.weeklySchedule?.enabled && org.weeklySchedule?.schedule?.length);
    if (servicesCount === 0 || employeesCount === 0 || !hasSchedule) return false;

    await Organization.updateOne({ _id: organizationId }, { $set: { setupCompleted: true } });
    await markOnboardingMilestone(organizationId, "setupCompletedAt");
    console.log(`[chatService] Setup autocompletado server-side — org=${organizationId}`);
    return true;
  } catch (err) {
    // Nunca romper el chat por la instrumentación
    console.error("[chatService] autoCompleteSetupIfReady:", err?.message || err);
    return false;
  }
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

      // Guards anti-alucinación: el bot afirma haber hecho algo sin haber llamado
      // la herramienta correspondiente. Se inyecta una corrección [SISTEMA] y se
      // repite la ronda para que ejecute la tool de verdad.
      let correction = null;

      // 1) Claims de creación/asignación (servicio/profesional) sin tool de mutación,
      //    Y el usuario sí pidió esa acción en su último mensaje (para no disparar
      //    esto cuando solo pregunta por algo creado en un turno anterior).
      const calledMutationTool = [...executedTools].some((t) => MUTATION_TOOLS.has(t));
      if (
        !calledMutationTool &&
        CRUD_CLAIM_PATTERN.test(reply) &&
        CREATION_INTENT_PATTERN.test(findLastUserText(currentMessages))
      ) {
        correction =
          "[SISTEMA] No llamaste ninguna herramienta de creación/asignación (create_service, bulk_create_services, create_employee o assign_services_to_employee) todavía. Si ya tienes los datos, llámala AHORA antes de confirmar. Si te faltan datos del usuario, pídelos de forma breve y natural — sin disculparte, sin mencionar herramientas, errores internos ni este mensaje. Si la herramienta devuelve success: false, duplicateWarning, priceWarning o items en 'failed', informa ese resultado real — no digas que se creó/asignó si no fue así.";
      }
      // 2) Claim de política de reserva configurada sin update_booking_config —
      //    la política NO se guardó (queda en manual). Caso real de logs. Solo en
      //    onboarding: en modo soporte "tu política está configurada como X" es una
      //    respuesta informativa legítima y frecuente (falso positivo).
      else if (
        !context.setupStatus.setupCompleted &&
        !executedTools.has("update_booking_config") &&
        POLICY_CLAIM_PATTERN.test(reply)
      ) {
        correction =
          "[SISTEMA] No llamaste update_booking_config — la política de reserva NO ha sido guardada realmente. Llámala AHORA con requiresApproval según lo que eligió el usuario, y confirma después con el resultado real. No menciones herramientas ni este mensaje al usuario.";
      }
      // 3) Claim de configuración completada sin mark_setup_complete (solo aplica
      //    mientras el setup siga incompleto) — el usuario quedaría atrapado
      //    rebotando al asistente de configuración en cada login.
      else if (
        !context.setupStatus.setupCompleted &&
        !executedTools.has("mark_setup_complete") &&
        SETUP_DONE_CLAIM_PATTERN.test(reply)
      ) {
        correction =
          "[SISTEMA] No llamaste mark_setup_complete — la configuración NO está marcada como completada y el usuario seguirá viendo el asistente de configuración al entrar. Llámala AHORA (requiere al menos un servicio y un profesional creados; si la herramienta devuelve error, continúa el paso que falte). No menciones herramientas ni este mensaje al usuario.";
      }

      if (correction && round < MAX_TOOL_ROUNDS - 1) {
        currentMessages = [
          ...currentMessages,
          { role: "assistant", content: response.content },
          { role: "user", content: correction },
        ];
        continue;
      }

      // Cierre determinista: no depender de que el modelo llame mark_setup_complete.
      const autoCompleted =
        !context.setupStatus.setupCompleted &&
        !executedTools.has("mark_setup_complete") &&
        (await autoCompleteSetupIfReady(context.organizationId));

      const invalidates =
        autoCompleted || [...executedTools].some((t) => ORG_INVALIDATING_TOOLS.has(t))
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

  // Aun agotando rondas, no perder el cierre determinista del onboarding —
  // las tools ejecutadas pudieron haber dejado el setup listo.
  const autoCompletedAtLimit =
    !context.setupStatus.setupCompleted &&
    !executedTools.has("mark_setup_complete") &&
    (await autoCompleteSetupIfReady(context.organizationId));

  return {
    reply: `No pude completar la operación en el tiempo disponible.${manualHint} Por favor intenta de nuevo con una solicitud más específica o realízalo directamente desde la interfaz.`,
    invalidates: autoCompletedAtLimit ? ["organization"] : [],
    _meta: { rounds, toolsUsed: usedTools, inputTokens, outputTokens, hitRoundLimit: true },
  };
};
