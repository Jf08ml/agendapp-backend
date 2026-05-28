import Anthropic from "@anthropic-ai/sdk";
import moment from "moment-timezone";
import WaConversation from "../models/waConversationModel.js";
import Service from "../models/serviceModel.js";
import Employee from "../models/employeeModel.js";
import Client from "../models/clientModel.js";
import appointmentService from "./appointmentService.js";
import clientService from "./clientService.js";
import { sendTextMessage, sendTemplateMessage } from "./metaApiService.js";
import { normalizePhone } from "./waAgentService.js";

const anthropic = new Anthropic();

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

function isAdminWindowOpen(convo, org) {
  const now = Date.now();
  const convWindow = convo.adminLastContactAt
    ? now - new Date(convo.adminLastContactAt).getTime() < WINDOW_24H_MS
    : false;
  const orgWindow = org.agentAdminLastContactAt
    ? now - new Date(org.agentAdminLastContactAt).getTime() < WINDOW_24H_MS
    : false;
  return convWindow || orgWindow;
}

// ─── Punto de entrada: primera vez que detectamos intención ──────────────────

export async function startDialogue(convo, org, intent) {
  const orgAdminPhone = normalizePhone(org.phoneNumber);

  // Validar ventana de 24h antes de enviar texto libre
  if (!isAdminWindowOpen(convo, org)) {
    console.log(`[WaDialogue] Ventana de 24h vencida — enviando plantilla re_activacion_ia al admin: ${orgAdminPhone}`);
    await sendTemplateMessage(orgAdminPhone, "re_activacion_ia");
    await WaConversation.findByIdAndUpdate(convo._id, {
      status: "summary_sent",
      awaitingWindowReopen: true,
    });
    return;
  }

  const identifierField = org.clientFormConfig?.identifierField || "phone";
  const [{ services, employees }, clientInfo] = await Promise.all([
    loadOrgData(org._id),
    loadClientInfo(convo.clientPhone, org._id, identifierField),
  ]);

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
    clientInfo,
  });

  if (!agentMessage) return;

  if (agentMessage.action === "ask") {
    await sendAndRecord(convo, orgAdminPhone, agentMessage.message);
  }

  if (agentMessage.action === "create_appointment") {
    const validationError = validateAgentIds(agentMessage, services, employees, clientInfo, org.clientFormConfig);
    if (validationError) {
      console.error("[WaDialogue] Validación fallida en startDialogue:", validationError, agentMessage);
      await sendAndRecord(convo, orgAdminPhone, `Falta información para crear la cita: ${validationError}`);
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

  // El admin respondió → ventana de 24h está abierta ahora
  await WaConversation.findByIdAndUpdate(convo._id, {
    adminLastContactAt: new Date(),
  });

  // Si veníamos esperando que el admin reabriera la ventana, relanzar el diálogo
  if (convo.awaitingWindowReopen) {
    console.log(`[WaDialogue] Admin reactivó ventana — retomando diálogo de intención (conv: ${convo._id})`);
    await WaConversation.findByIdAndUpdate(convo._id, {
      awaitingWindowReopen: false,
      status: "intent_detected",
    });
    const freshConvo = await WaConversation.findById(convo._id).lean();
    await startDialogue(freshConvo, org, freshConvo.detectedIntent).catch((err) =>
      console.error("[WaDialogue] Error relanzando diálogo tras reactivación:", err)
    );
    return;
  }

  const [{ services, employees }] = await Promise.all([
    loadOrgData(org._id),
  ]);
  const orgAdminPhone = normalizePhone(org.phoneNumber);

  // Agregar respuesta del admin al historial
  await WaConversation.findByIdAndUpdate(convo._id, {
    $push: { adminConversation: { role: "admin", body: adminReply } },
  });

  const updatedConvo = await WaConversation.findById(convo._id).lean();
  const identifierField = org.clientFormConfig?.identifierField || "phone";
  const clientInfo = await loadClientInfo(convo.clientPhone, org._id, identifierField);

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
    clientInfo,
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
    const validationError = validateAgentIds(agentMessage, services, employees, clientInfo, org.clientFormConfig);
    if (validationError) {
      console.error("[WaDialogue] Validación fallida en continueDialogue:", validationError, agentMessage);
      await sendAndRecord(updatedConvo, orgAdminPhone, `Falta información para crear la cita: ${validationError}`);
      return;
    }
    await createAppointment(updatedConvo, org, agentMessage, orgAdminPhone, services);
  }
}

// ─── LLM: orquestador del diálogo ───────────────────────────────────────────

async function runDialogueAgent({ org, services, employees, clientConvText, adminConversation, clientPhone, clientInfo }) {
  const now = moment().tz(org.timezone || "America/Bogota").format("dddd D [de] MMMM [de] YYYY, HH:mm");

  const servicesList = services
    .map((s) => `• ${s.name} — ${s.duration}min — $${s.price} | id:${s._id}`)
    .join("\n");

  const employeesList = employees
    .map((e) => `• ${e.names} | id:${e._id}`)
    .join("\n");

  const adminConvText = adminConversation.length
    ? adminConversation.map((m) => `${m.role === "agent" ? "Agente" : "Admin"}: ${m.body}`).join("\n")
    : "(sin mensajes aún)";

  const clientSection = clientInfo.exists === true
    ? `CLIENTE: Ya registrado como "${clientInfo.name}" (${clientPhone}). No necesitas pedir datos del cliente.`
    : buildNewClientSection(clientPhone, org.clientFormConfig);

  const systemPrompt = `Eres el asistente de agenda de AgenditApp para ${org.name}.
Un cliente escribió al WhatsApp del negocio solicitando una cita. Tu trabajo es confirmar los detalles con el administrador por WhatsApp y crear la cita cuando todo esté confirmado.

FECHA Y HORA ACTUAL (${org.timezone || "America/Bogota"}): ${now}

SERVICIOS DISPONIBLES (ÚNICAMENTE ESTOS — no inventes otros):
${servicesList || "(ninguno registrado)"}

PROFESIONALES DISPONIBLES (ÚNICAMENTE ESTOS — no inventes otros):
${employeesList || "(ninguno registrado)"}

${clientSection}

INSTRUCCIONES:
- Escribe en español. Mensajes cortos y directos para WhatsApp.
- SOLO usa los IDs exactos de las listas de arriba. NUNCA inventes ni uses IDs que no aparezcan en esas listas.
- Si el admin menciona un profesional o servicio que no está en la lista, pregúntale cuál de los disponibles prefiere.
- Sugiere opciones reales de la lista cuando el admin no especifica (ej: "¿Con quién? Tenemos a Nataly y Mariana")
- Si el cliente NO está registrado, extrae de la conversación lo que puedas (nombre, email, etc.) y pregunta al admin por los campos requeridos que falten. No preguntes por campos opcionales a menos que el admin los mencione.
- Agrupa las preguntas de datos del cliente en un solo mensaje para no saturar al admin.
- Cuando tengas todos los datos confirmados (servicio(s), profesional(es), fecha/hora y datos del cliente), responde con create_appointment
- Si son VARIAS citas, inclúyelas TODAS en el array "appointments" de UN SOLO JSON — nunca devuelvas múltiples JSONs separados
- Si el admin rechaza o dice que no, responde con la acción reject
- Responde SOLO con JSON válido, sin markdown, sin bloques de código, sin texto adicional

FORMATOS DE RESPUESTA POSIBLES:
{"action":"ask","message":"tu pregunta al admin aquí"}
{"action":"create_appointment","appointments":[{"serviceId":"id_exacto","employeeId":"id_exacto","startDate":"YYYY-MM-DDTHH:mm:ss","notes":"nota opcional"}],"clientData":{"name":"nombre","email":"email o null","documentId":"doc o null","birthDate":"YYYY-MM-DD o null","notes":"notas o null"}}
{"action":"reject"}`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
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
    // Extraer el primer bloque JSON (con o sin markdown) e ignorar el resto
    const stripped = raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
    // Tomar solo el primer objeto JSON completo
    const firstBrace = stripped.indexOf("{");
    const lastBrace = stripped.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1) throw new Error("No JSON found");
    const jsonStr = stripped.slice(firstBrace, lastBrace + 1);
    return JSON.parse(jsonStr);
  } catch {
    console.error("[WaDialogue] LLM no devolvió JSON válido:", raw);
    return null;
  }
}

// ─── Creación de la cita ─────────────────────────────────────────────────────

async function createAppointment(convo, org, agentData, orgAdminPhone, services) {
  const tz = org.timezone || "America/Bogota";
  const appointments = agentData.appointments || [];

  try {
    // Resolver/crear cliente
    const identifierField = org.clientFormConfig?.identifierField || "phone";
    const cd = agentData.clientData || {};
    const identifierValue = identifierField === "phone" ? convo.clientPhone : cd[identifierField];

    let client = identifierValue
      ? await clientService.getClientByIdentifier(identifierField, identifierValue, org._id)
      : null;

    if (!client) {
      client = await clientService.createClient({
        name: cd.name?.trim() || `Cliente WA ${convo.clientPhone}`,
        email: cd.email || undefined,
        documentId: cd.documentId || undefined,
        birthDate: cd.birthDate || undefined,
        notes: cd.notes || undefined,
        phoneNumber: convo.clientPhone,
        organizationId: org._id,
      });
    }

    const createdIds = [];
    const resumenLines = [];

    for (const appt of appointments) {
      const service = services.find((s) => s._id.toString() === appt.serviceId);
      if (!service) throw new Error(`Servicio no encontrado: ${appt.serviceId}`);

      const startMoment = moment.tz(appt.startDate, "YYYY-MM-DDTHH:mm:ss", tz);
      const endMoment = startMoment.clone().add(service.duration, "minutes");

      const created = await appointmentService.createAppointment({
        service: appt.serviceId,
        employee: appt.employeeId,
        employeeRequestedByClient: false,
        client,
        startDate: appt.startDate,
        endDate: endMoment.format("YYYY-MM-DDTHH:mm:ss"),
        organizationId: org._id,
        notes: appt.notes || "Cita gestionada por asistente WA de AgenditApp",
        skipNotification: appointments.length > 1, // evitar WA por cada cita si son varias
      });

      createdIds.push(created._id);
      resumenLines.push(`📅 ${startMoment.format("ddd D/MM [a las] HH:mm")} — ${service.name}`);
    }

    await WaConversation.findByIdAndUpdate(convo._id, {
      status: "confirmed",
      appointmentId: createdIds[0],
    });

    const resumen = resumenLines.join("\n");
    const plural = appointments.length > 1 ? `${appointments.length} citas creadas` : "Cita creada";
    await sendTextMessage(
      orgAdminPhone,
      `✅ ${plural} exitosamente para ${client.name || convo.clientPhone}\n${resumen}`
    );

    console.log(`[WaDialogue] ${appointments.length} cita(s) creada(s) — conv: ${convo._id}`);
  } catch (err) {
    console.error("[WaDialogue] Error creando cita(s):", err.message);
    await sendTextMessage(
      orgAdminPhone,
      `❌ No pude crear la(s) cita(s): ${err.message}\nPor favor créalas manualmente en AgenditApp.`
    );
    await WaConversation.findByIdAndUpdate(convo._id, { status: "rejected" });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FIELD_LABELS = {
  name: "Nombre",
  email: "Email",
  documentId: "Documento de identidad",
  birthDate: "Fecha de nacimiento (YYYY-MM-DD)",
  notes: "Notas",
};

const DEFAULT_FIELDS = [
  { key: "name", enabled: true, required: true },
  { key: "phone", enabled: true, required: true },
  { key: "email", enabled: true, required: false },
  { key: "birthDate", enabled: false, required: false },
  { key: "documentId", enabled: false, required: false },
  { key: "notes", enabled: false, required: false },
];

function buildNewClientSection(clientPhone, clientFormConfig) {
  const identifierField = clientFormConfig?.identifierField || "phone";
  const fields = clientFormConfig?.fields?.length ? clientFormConfig.fields : DEFAULT_FIELDS;

  // El campo identificador siempre es requerido para poder registrar al cliente
  const relevant = fields
    .filter((f) => f.key !== "phone" && f.enabled)
    .map((f) => ({
      ...f,
      required: f.required || f.key === identifierField,
    }));

  const required = relevant.filter((f) => f.required).map((f) => `  - ${f.label || FIELD_LABELS[f.key] || f.key} (REQUERIDO)`);
  const optional = relevant.filter((f) => !f.required).map((f) => `  - ${f.label || FIELD_LABELS[f.key] || f.key} (opcional)`);

  const lines = [...required, ...optional];

  const identifierNote = identifierField !== "phone"
    ? `\nEl identificador principal de clientes en esta organización es: ${FIELD_LABELS[identifierField] || identifierField}. Debes recopilarlo para verificar si el cliente ya existe o es nuevo.`
    : "";

  return `CLIENTE: Número WA ${clientPhone} — identidad no confirmada aún.${identifierNote}
Recopila estos datos (el admin puede conocerlos o los puede pedir al cliente):
${lines.length ? lines.join("\n") : "  - Nombre (REQUERIDO)"}
Extrae lo que puedas de la conversación. Pregunta al admin solo por los REQUERIDOS que falten, en un único mensaje.`;
}

async function loadClientInfo(clientPhone, orgId, identifierField) {
  if (identifierField === "phone") {
    const client = await clientService.getClientByIdentifier("phone", clientPhone, orgId);
    return client
      ? { exists: true, name: client.name, identifierField }
      : { exists: false, name: null, identifierField };
  }
  // Si el identificador no es teléfono, no podemos hacer el lookup aún —
  // necesitamos que el LLM recopile ese valor del admin primero.
  return { exists: "unknown", name: null, identifierField };
}

async function loadOrgData(orgId) {
  const [services, employees] = await Promise.all([
    Service.find({ organizationId: orgId, isActive: true }).select("_id name duration price").lean(),
    Employee.find({ organizationId: orgId, isActive: true }).select("_id names").lean(),
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

function validateAgentIds(agentMessage, services, employees, clientInfo, clientFormConfig) {
  const appointments = agentMessage.appointments || [];
  if (!appointments.length) return "No se encontraron citas en el mensaje del agente.";

  for (const appt of appointments) {
    const serviceOk = services.some((s) => s._id.toString() === appt.serviceId);
    const employeeOk = employees.some((e) => e._id.toString() === appt.employeeId);
    if (!serviceOk) return `Servicio "${appt.serviceId}" no encontrado en la lista.`;
    if (!employeeOk) return `Profesional "${appt.employeeId}" no encontrado en la lista.`;
  }

  // Si el cliente no está confirmado como existente, verificar campos requeridos
  if (clientInfo.exists !== true) {
    const identifierField = clientFormConfig?.identifierField || "phone";
    const fields = clientFormConfig?.fields?.length ? clientFormConfig.fields : DEFAULT_FIELDS;
    const requiredKeys = fields
      .filter((f) => f.key !== "phone" && f.enabled && (f.required || f.key === identifierField))
      .map((f) => f.key);
    const cd = agentMessage.clientData || {};
    for (const key of requiredKeys) {
      if (!cd[key]?.toString().trim()) {
        return `Falta el campo requerido del cliente: ${FIELD_LABELS[key] || key}.`;
      }
    }
  }

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
