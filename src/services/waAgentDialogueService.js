import Anthropic from "@anthropic-ai/sdk";
import moment from "moment-timezone";
import WaConversation from "../models/waConversationModel.js";
import Service from "../models/serviceModel.js";
import Employee from "../models/employeeModel.js";
import Client from "../models/clientModel.js";
import appointmentService from "./appointmentService.js";
import clientService from "./clientService.js";
import { sendTextMessage } from "./metaApiService.js";
import { normalizePhone } from "./waAgentService.js";

const anthropic = new Anthropic();

// ─── Punto de entrada: primera vez que detectamos intención ──────────────────

export async function startDialogue(convo, org, intent) {
  const { services, employees } = await loadOrgData(org._id);
  const orgAdminPhone = normalizePhone(org.phoneNumber);

  const clientConvText = convo.messages
    .map((m) => `${m.role === "client" ? "Cliente" : "Negocio"}: ${m.body}`)
    .join("\n");

  const agentMessage = await runDialogueAgent({
    org,
    services,
    employees,
    clientConvText,
    adminConversation: [],
    clientPhone: convo.clientPhone,
  });

  if (!agentMessage) return;

  if (agentMessage.action === "ask") {
    await sendAndRecord(convo, orgAdminPhone, agentMessage.message);
  }

  if (agentMessage.action === "create_appointment") {
    const validationError = validateAgentIds(agentMessage, services, employees);
    if (validationError) {
      console.error("[WaDialogue] IDs inválidos del LLM en startDialogue:", validationError, agentMessage);
      await sendAndRecord(convo, orgAdminPhone, `No pude identificar el servicio o profesional. ¿Puedes confirmar? ${validationError}`);
      return;
    }
    const freshConvo = await WaConversation.findById(convo._id).lean();
    await createAppointment(freshConvo, org, agentMessage, orgAdminPhone, services);
  }
}

// ─── Continúa el diálogo cuando el admin responde ───────────────────────────

export async function continueDialogue(convo, org, adminReply) {
  // Ignorar mensajes automáticos de bienvenida — el admin aún no respondió realmente
  if (isAutoReply(adminReply, org.name)) {
    console.log("[WaDialogue] Mensaje automático ignorado, esperando respuesta real del admin");
    return;
  }

  const { services, employees } = await loadOrgData(org._id);
  const orgAdminPhone = normalizePhone(org.phoneNumber);

  // Agregar respuesta del admin al historial
  await WaConversation.findByIdAndUpdate(convo._id, {
    $push: { adminConversation: { role: "admin", body: adminReply } },
  });

  const updatedConvo = await WaConversation.findById(convo._id).lean();

  const clientConvText = updatedConvo.messages
    .map((m) => `${m.role === "client" ? "Cliente" : "Negocio"}: ${m.body}`)
    .join("\n");

  const agentMessage = await runDialogueAgent({
    org,
    services,
    employees,
    clientConvText,
    adminConversation: updatedConvo.adminConversation,
    clientPhone: convo.clientPhone,
  });

  if (!agentMessage) return;

  if (agentMessage.action === "reject") {
    await WaConversation.findByIdAndUpdate(convo._id, { status: "rejected" });
    await sendTextMessage(orgAdminPhone, "Ok, no se creará la cita.");
    return;
  }

  if (agentMessage.action === "ask") {
    await sendAndRecord(updatedConvo, orgAdminPhone, agentMessage.message);
    return;
  }

  if (agentMessage.action === "create_appointment") {
    const validationError = validateAgentIds(agentMessage, services, employees);
    if (validationError) {
      console.error("[WaDialogue] IDs inválidos del LLM:", validationError, agentMessage);
      await sendAndRecord(updatedConvo, orgAdminPhone, `No pude identificar el servicio o profesional correctamente. ¿Puedes confirmar? ${validationError}`);
      return;
    }
    await createAppointment(updatedConvo, org, agentMessage, orgAdminPhone, services);
  }
}

// ─── LLM: orquestador del diálogo ───────────────────────────────────────────

async function runDialogueAgent({ org, services, employees, clientConvText, adminConversation, clientPhone }) {
  const now = moment().tz(org.timezone || "America/Bogota").format("dddd D [de] MMMM [de] YYYY, HH:mm");

  const servicesList = services
    .map((s) => `• ${s.name} — ${s.duration}min — $${s.price} | id:${s._id}`)
    .join("\n");

  const employeesList = employees
    .map((e) => `• ${e.name} | id:${e._id}`)
    .join("\n");

  const adminConvText = adminConversation.length
    ? adminConversation.map((m) => `${m.role === "agent" ? "Agente" : "Admin"}: ${m.body}`).join("\n")
    : "(sin mensajes aún)";

  const systemPrompt = `Eres el asistente de agenda de AgenditApp para ${org.name}.
Un cliente escribió al WhatsApp del negocio solicitando una cita. Tu trabajo es confirmar los detalles con el administrador por WhatsApp y crear la cita cuando todo esté confirmado.

FECHA Y HORA ACTUAL (${org.timezone || "America/Bogota"}): ${now}

SERVICIOS DISPONIBLES (ÚNICAMENTE ESTOS — no inventes otros):
${servicesList || "(ninguno registrado)"}

PROFESIONALES DISPONIBLES (ÚNICAMENTE ESTOS — no inventes otros):
${employeesList || "(ninguno registrado)"}

INSTRUCCIONES:
- Escribe en español. Mensajes cortos y directos para WhatsApp.
- SOLO usa los IDs exactos de las listas de arriba. NUNCA inventes ni uses IDs que no aparezcan en esas listas.
- Si el admin menciona un profesional o servicio que no está en la lista, pregúntale cuál de los disponibles prefiere.
- Sugiere opciones reales de la lista cuando el admin no especifica (ej: "¿Con quién? Tenemos a Nataly y Mariana")
- Cuando tengas servicio + profesional + fecha/hora confirmados por el admin, responde con la acción create_appointment
- Si el admin rechaza o dice que no, responde con la acción reject
- Responde SOLO con JSON sin markdown ni texto adicional

FORMATOS DE RESPUESTA POSIBLES:
{"action":"ask","message":"tu pregunta al admin aquí"}
{"action":"create_appointment","serviceId":"id_exacto_de_la_lista","employeeId":"id_exacto_de_la_lista","startDate":"YYYY-MM-DDTHH:mm:ss","notes":"contexto extra"}
{"action":"reject"}`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `CONVERSACIÓN DEL CLIENTE CON EL NEGOCIO:\n${clientConvText}\n\nNÚMERO DEL CLIENTE: ${clientPhone}\n\nHISTORIAL DEL DIÁLOGO CON EL ADMIN:\n${adminConvText}\n\n¿Cuál es el siguiente paso?`,
      },
    ],
  });

  const raw = response.content[0].text;
  try {
    const jsonStr = raw.replace(/```(?:json)?\s*([\s\S]*?)\s*```/, "$1").trim();
    return JSON.parse(jsonStr);
  } catch {
    console.error("[WaDialogue] LLM no devolvió JSON válido:", raw);
    return null;
  }
}

// ─── Creación de la cita ─────────────────────────────────────────────────────

async function createAppointment(convo, org, agentData, orgAdminPhone, services) {
  try {
    const service = services.find((s) => s._id.toString() === agentData.serviceId);
    if (!service) throw new Error(`Servicio no encontrado: ${agentData.serviceId}`);

    const startMoment = moment.tz(agentData.startDate, "YYYY-MM-DDTHH:mm:ss", org.timezone || "America/Bogota");
    const endMoment = startMoment.clone().add(service.duration, "minutes");
    const endDate = endMoment.format("YYYY-MM-DDTHH:mm:ss");

    // Buscar o crear el cliente por teléfono
    let client = await clientService.getClientByIdentifier("phone", convo.clientPhone, org._id);
    if (!client) {
      client = await clientService.createClient({
        name: `Cliente WA ${convo.clientPhone}`,
        phoneNumber: convo.clientPhone,
        organizationId: org._id,
      });
    }

    const appointment = await appointmentService.createAppointment({
      service: agentData.serviceId,
      employee: agentData.employeeId,
      employeeRequestedByClient: false,
      client: client,
      startDate: agentData.startDate,
      endDate,
      organizationId: org._id,
      notes: agentData.notes || "Cita gestionada por asistente WA de AgenditApp",
    });

    await WaConversation.findByIdAndUpdate(convo._id, {
      status: "confirmed",
      appointmentId: appointment._id,
    });

    const dateLabel = startMoment.format("dddd D [de] MMMM [a las] HH:mm");
    await sendTextMessage(
      orgAdminPhone,
      `✅ Cita creada exitosamente\n📅 ${dateLabel}\n💆 Servicio: ${service.name}\n👩 Cliente: ${client.name || convo.clientPhone}`
    );

    console.log(`[WaDialogue] Cita creada — appointment: ${appointment._id}, conv: ${convo._id}`);
  } catch (err) {
    console.error("[WaDialogue] Error creando cita:", err.message);
    await sendTextMessage(
      orgAdminPhone,
      `❌ No pude crear la cita: ${err.message}\nPor favor creala manualmente en AgenditApp.`
    );
    await WaConversation.findByIdAndUpdate(convo._id, { status: "rejected" });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loadOrgData(orgId) {
  const [services, employees] = await Promise.all([
    Service.find({ organizationId: orgId, isActive: true }).select("_id name duration price").lean(),
    Employee.find({ organizationId: orgId, isActive: true }).select("_id name").lean(),
  ]);
  return { services, employees };
}

function isAutoReply(body, orgName) {
  const lower = body.toLowerCase();
  const autoKeywords = ["bienvenid", "hola", "gracias por contactar", "en breve", "horario de atención", "reservar tu cita"];
  const matchCount = autoKeywords.filter((kw) => lower.includes(kw)).length;
  // Si tiene 2+ palabras clave de auto-respuesta, probablemente es automático
  return matchCount >= 2;
}

function validateAgentIds(agentMessage, services, employees) {
  const serviceOk = services.some((s) => s._id.toString() === agentMessage.serviceId);
  const employeeOk = employees.some((e) => e._id.toString() === agentMessage.employeeId);
  if (!serviceOk) return `Servicio "${agentMessage.serviceId}" no encontrado.`;
  if (!employeeOk) return `Profesional "${agentMessage.employeeId}" no encontrado.`;
  return null;
}

async function sendAndRecord(convo, orgAdminPhone, message) {
  const { messageId } = await sendTextMessage(orgAdminPhone, message);
  await WaConversation.findByIdAndUpdate(convo._id, {
    status: "summary_sent",
    metaMessageId: messageId,
    $push: { adminConversation: { role: "agent", body: message } },
  });
  console.log(`[WaDialogue] Mensaje enviado al admin — conv: ${convo._id}`);
}
