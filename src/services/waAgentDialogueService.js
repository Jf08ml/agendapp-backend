import Anthropic from "@anthropic-ai/sdk";
import moment from "moment-timezone";
import WaConversation from "../models/waConversationModel.js";
import Service from "../models/serviceModel.js";
import Employee from "../models/employeeModel.js";
import Client from "../models/clientModel.js";
import Appointment from "../models/appointmentModel.js";
import appointmentService from "./appointmentService.js";
import clientService from "./clientService.js";
import cancellationService from "./cancellationService.js";
import { sendTextMessage, sendTemplateMessage } from "./metaApiService.js";
import { normalizePhone } from "./waAgentService.js";

const anthropic = new Anthropic();

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const CANCELLED_STATUSES = ["cancelled", "cancelled_by_customer", "cancelled_by_admin"];

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

// ─── Tabla de referencias de fechas pre-calculadas ───────────────────────────
// El LLM (Haiku) calcula mal fechas relativas ("el viernes" → día equivocado)
// si se le deja hacer la aritmética de día-de-semana por su cuenta. En vez de
// eso, le damos la tabla ya resuelta y la regla de "nunca calcules tú mismo"
// — mismo patrón ya probado en bookingSystemPrompt.js.
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function buildDateReferenceLines(tz) {
  const nowMoment = moment().tz(tz);
  const dow = nowMoment.day(); // 0=Dom … 6=Sáb

  const fmtRef = (m) => `${m.format("YYYY-MM-DD")} (${DAY_NAMES[m.day()]} ${m.date()} de ${MONTH_NAMES[m.month()]})`;

  const nextOccurrence = (targetDow) => {
    let diff = targetDow - dow;
    if (diff < 0) diff += 7;
    return nowMoment.clone().add(diff, "days");
  };

  const refs = {
    "hoy": nowMoment.clone(),
    "mañana": nowMoment.clone().add(1, "days"),
    "este domingo / el domingo": nextOccurrence(0),
    "este lunes / el lunes": nextOccurrence(1),
    "este martes / el martes": nextOccurrence(2),
    "este miércoles / el miércoles": nextOccurrence(3),
    "este jueves / el jueves": nextOccurrence(4),
    "este viernes / el viernes": nextOccurrence(5),
    "este sábado / el sábado": nextOccurrence(6),
    "próxima semana (lunes)": nowMoment.clone().add(7 - dow + 1, "days"),
    "en 2 semanas": nowMoment.clone().add(14, "days"),
  };

  return Object.entries(refs)
    .map(([label, m]) => `  - "${label}" → ${fmtRef(m)}`)
    .join("\n");
}

// ─── Punto de entrada: primera vez que detectamos intención ──────────────────

export async function startDialogue(convo, org, intent) {
  const orgAdminPhone = normalizePhone(org.phoneNumber);

  console.log(
    `[WaDialogue] (3) DIÁLOGO — iniciando con admin ${orgAdminPhone} (org: ${org.name}) — ` +
    `intención: ${intent?.intent || intent?.type || "?"} — conv: ${convo._id}`
  );

  // Validar ventana de 24h antes de enviar texto libre
  if (!isAdminWindowOpen(convo, org)) {
    console.log(`[WaDialogue] (3) DIÁLOGO — ventana de 24h cerrada — enviando plantilla "re_activacion_ia" a ${orgAdminPhone} — conv: ${convo._id}`);
    try {
      const { messageId } = await sendTemplateMessage(orgAdminPhone, "re_activacion_ia");
      console.log(`[WaDialogue] (3) DIÁLOGO — plantilla "re_activacion_ia" enviada — messageId: ${messageId} — conv: ${convo._id}`);
    } catch (err) {
      console.error(
        `[WaDialogue] (3) DIÁLOGO — ERROR enviando plantilla "re_activacion_ia" a ${orgAdminPhone} — conv: ${convo._id}:`,
        err.response?.data || err.message
      );
      throw err;
    }
    await WaConversation.findByIdAndUpdate(convo._id, {
      status: "summary_sent",
      awaitingWindowReopen: true,
    });
    return;
  }

  console.log(`[WaDialogue] (3) DIÁLOGO — ventana de 24h abierta — se puede enviar texto libre a ${orgAdminPhone} — conv: ${convo._id}`);

  const identifierField = org.clientFormConfig?.identifierField || "phone";
  const tz = org.timezone || "America/Bogota";
  const [{ services, employees }, clientInfo, clientAppointments] = await Promise.all([
    loadOrgData(org._id),
    loadClientInfo(convo.clientPhone, org._id, identifierField),
    loadClientAppointments(convo.clientPhone, org._id, tz),
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
    clientAppointments,
  });

  if (!agentMessage) {
    console.warn(`[WaDialogue] (3) DIÁLOGO — el LLM orquestador no devolvió una acción válida — no se contacta al admin — conv: ${convo._id}`);
    return;
  }

  console.log(`[WaDialogue] (3) DIÁLOGO — LLM decidió acción "${agentMessage.action}" — conv: ${convo._id}`);

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

  if (agentMessage.action === "cancel_appointment") {
    const validationError = validateAppointmentId(agentMessage, clientAppointments);
    if (validationError) {
      console.error("[WaDialogue] Validación fallida en startDialogue (cancel):", validationError, agentMessage);
      await sendAndRecord(convo, orgAdminPhone, `No pude identificar la cita a cancelar: ${validationError}`);
      return;
    }
    const freshConvo = await WaConversation.findById(convo._id).lean();
    await cancelAppointmentViaAgent(freshConvo, org, agentMessage, orgAdminPhone, clientAppointments);
  }

  if (agentMessage.action === "reschedule_appointment") {
    const validationError = validateAppointmentId(agentMessage, clientAppointments);
    if (validationError) {
      console.error("[WaDialogue] Validación fallida en startDialogue (reschedule):", validationError, agentMessage);
      await sendAndRecord(convo, orgAdminPhone, `No pude identificar la cita a reprogramar: ${validationError}`);
      return;
    }
    const freshConvo = await WaConversation.findById(convo._id).lean();
    await rescheduleAppointmentViaAgent(freshConvo, org, agentMessage, orgAdminPhone, clientAppointments);
  }
}

// ─── Continúa el diálogo cuando el admin responde ───────────────────────────

export async function continueDialogue(convo, org, adminReply) {
  console.log(`[WaDialogue] (4) DIÁLOGO — continuando con respuesta del admin: "${adminReply.slice(0, 100)}" — conv: ${convo._id}`);

  // Ignorar mensajes automáticos de bienvenida — el admin aún no respondió realmente
  if (isAutoReply(adminReply, org.name)) {
    console.log(`[WaDialogue] (4) DIÁLOGO — mensaje detectado como auto-respuesta de bienvenida, se ignora — conv: ${convo._id}`);
    return;
  }

  // El admin respondió → ventana de 24h está abierta ahora
  await WaConversation.findByIdAndUpdate(convo._id, {
    adminLastContactAt: new Date(),
  });

  // Si veníamos esperando que el admin reabriera la ventana, relanzar el diálogo
  if (convo.awaitingWindowReopen) {
    console.log(`[WaDialogue] (4) DIÁLOGO — admin reactivó la ventana de 24h — retomando diálogo de intención "${convo.detectedIntent?.type}" — conv: ${convo._id}`);
    await WaConversation.findByIdAndUpdate(convo._id, {
      awaitingWindowReopen: false,
      status: "intent_detected",
    });
    const freshConvo = await WaConversation.findById(convo._id).lean();
    await startDialogue(freshConvo, org, freshConvo.detectedIntent).catch((err) =>
      console.error(`[WaDialogue] (4) DIÁLOGO — error relanzando diálogo tras reactivación de ventana — conv: ${convo._id}:`, err)
    );
    return;
  }

  const tz = org.timezone || "America/Bogota";
  const identifierField = org.clientFormConfig?.identifierField || "phone";
  const [{ services, employees }, clientInfo, clientAppointments] = await Promise.all([
    loadOrgData(org._id),
    loadClientInfo(convo.clientPhone, org._id, identifierField),
    loadClientAppointments(convo.clientPhone, org._id, tz),
  ]);
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
    clientInfo,
    clientAppointments,
  });

  if (!agentMessage) {
    console.warn(`[WaDialogue] (4) DIÁLOGO — el LLM orquestador no devolvió una acción válida tras la respuesta del admin — conv: ${convo._id}`);
    return;
  }

  console.log(`[WaDialogue] (4) DIÁLOGO — LLM decidió acción "${agentMessage.action}" — conv: ${convo._id}`);

  if (agentMessage.action === "reject") {
    await WaConversation.findByIdAndUpdate(convo._id, { status: "rejected" });
    await sendTextMessage(orgAdminPhone, "Ok, no se realizará ningún cambio en la agenda.");
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

  if (agentMessage.action === "cancel_appointment") {
    const validationError = validateAppointmentId(agentMessage, clientAppointments);
    if (validationError) {
      console.error("[WaDialogue] Validación fallida en continueDialogue (cancel):", validationError, agentMessage);
      await sendAndRecord(updatedConvo, orgAdminPhone, `No pude identificar la cita a cancelar: ${validationError}`);
      return;
    }
    await cancelAppointmentViaAgent(updatedConvo, org, agentMessage, orgAdminPhone, clientAppointments);
  }

  if (agentMessage.action === "reschedule_appointment") {
    const validationError = validateAppointmentId(agentMessage, clientAppointments);
    if (validationError) {
      console.error("[WaDialogue] Validación fallida en continueDialogue (reschedule):", validationError, agentMessage);
      await sendAndRecord(updatedConvo, orgAdminPhone, `No pude identificar la cita a reprogramar: ${validationError}`);
      return;
    }
    await rescheduleAppointmentViaAgent(updatedConvo, org, agentMessage, orgAdminPhone, clientAppointments);
  }
}

// ─── LLM: orquestador del diálogo ───────────────────────────────────────────

async function runDialogueAgent({ org, services, employees, clientConvText, adminConversation, clientPhone, clientInfo, clientAppointments = [] }) {
  const tz = org.timezone || "America/Bogota";
  const now = moment().tz(tz).format("dddd D [de] MMMM [de] YYYY, HH:mm");
  const dateRefLines = buildDateReferenceLines(tz);

  const servicesList = services
    .map((s) => `• ${s.name} — ${s.duration}min — $${s.price} | id:${s._id}`)
    .join("\n");

  const employeesList = employees
    .map((e) => `• ${e.names} | id:${e._id}`)
    .join("\n");

  const appointmentsList = clientAppointments.length
    ? clientAppointments
        .map((a) => {
          const fecha = moment(a.startDate).tz(tz).format("dddd D/MM [a las] HH:mm");
          return `• ${a.service?.name || "?"} con ${a.employee?.names || "?"} el ${fecha} | id:${a._id}`;
        })
        .join("\n")
    : "(el cliente no tiene citas próximas registradas)";

  const adminConvText = adminConversation.length
    ? adminConversation.map((m) => `${m.role === "agent" ? "Agente" : "Admin"}: ${m.body}`).join("\n")
    : "(sin mensajes aún)";

  const clientSection = clientInfo.exists === true
    ? `CLIENTE: Ya registrado como "${clientInfo.name}" (${clientPhone}). No necesitas pedir datos del cliente.`
    : buildNewClientSection(clientPhone, org.clientFormConfig);

  const systemPrompt = `Eres el asistente de agenda de AgenditApp para ${org.name}.
Un cliente escribió al WhatsApp del negocio para agendar, cancelar o reprogramar una cita. Tu trabajo es confirmar los detalles con el administrador por WhatsApp y ejecutar la acción cuando todo esté confirmado.

FECHA Y HORA ACTUAL (${tz}): ${now}

REFERENCIAS DE FECHAS PRE-CALCULADAS — zona horaria: ${tz}
REGLA CRÍTICA: NUNCA calcules fechas tú mismo (ni "qué día cae el viernes", ni sumas de días). Cuando el cliente o el admin mencionen un día relativo ("el viernes", "mañana", "este lunes"...), busca la etiqueta correspondiente en esta lista y usa EXACTAMENTE el valor YYYY-MM-DD que aparece junto a ella — no lo recalcules ni lo ajustes.
${dateRefLines}

SERVICIOS DISPONIBLES (ÚNICAMENTE ESTOS — no inventes otros):
${servicesList || "(ninguno registrado)"}

PROFESIONALES DISPONIBLES (ÚNICAMENTE ESTOS — no inventes otros):
${employeesList || "(ninguno registrado)"}

CITAS PRÓXIMAS DE ESTE CLIENTE (ÚNICAMENTE ESTAS — usa el id_exacto para cancelar/reprogramar):
${appointmentsList}

${clientSection}

INSTRUCCIONES:
- Escribe en español. Mensajes cortos y directos para WhatsApp.
- SOLO usa los IDs exactos de las listas de arriba. NUNCA inventes ni uses IDs que no aparezcan en esas listas.
- Si el admin menciona un profesional, servicio o cita que no está en las listas, pregúntale cuál de los disponibles prefiere.
- Sugiere opciones reales de la lista cuando el admin no especifica (ej: "¿Con quién? Tenemos a Nataly y Mariana")

PARA AGENDAR (create_appointment):
- Si el cliente NO está registrado, extrae de la conversación lo que puedas (nombre, email, etc.) y pregunta al admin por los campos requeridos que falten. No preguntes por campos opcionales a menos que el admin los mencione.
- Agrupa las preguntas de datos del cliente en un solo mensaje para no saturar al admin.
- Cuando tengas todos los datos confirmados (servicio(s), profesional(es), fecha/hora y datos del cliente), responde con create_appointment.
- Si son VARIAS citas, inclúyelas TODAS en el array "appointments" de UN SOLO JSON — nunca devuelvas múltiples JSONs separados.

PARA CANCELAR (cancel_appointment):
- Identifica la cita exacta en la lista "CITAS PRÓXIMAS DE ESTE CLIENTE" usando lo que dice el cliente (servicio, fecha, profesional).
- Si hay una sola coincidencia clara, pregúntale al admin si confirma la cancelación describiéndola (servicio, fecha/hora, profesional). Solo responde cancel_appointment cuando el admin confirme explícitamente.
- Si hay varias citas que podrían coincidir o ninguna, pregúntale al admin cuál es (o avísale que no encontraste ninguna).

PARA REPROGRAMAR (reschedule_appointment):
- Identifica la cita exacta igual que para cancelar, y la nueva fecha/hora que pide el cliente.
- Confírmale al admin la cita actual y el nuevo horario propuesto antes de ejecutar. Solo responde reschedule_appointment cuando el admin confirme explícitamente.
- El reagendamiento solo cambia la fecha/hora — mantiene el mismo servicio y profesional.

- Si el admin rechaza o dice que no, responde con la acción reject.
- Responde SOLO con JSON válido, sin markdown, sin bloques de código, sin texto adicional.

FORMATOS DE RESPUESTA POSIBLES:
{"action":"ask","message":"tu pregunta al admin aquí"}
{"action":"create_appointment","appointments":[{"serviceId":"id_exacto","employeeId":"id_exacto","startDate":"YYYY-MM-DDTHH:mm:ss","notes":"nota opcional"}],"clientData":{"name":"nombre","email":"email o null","documentId":"doc o null","birthDate":"YYYY-MM-DD o null","notes":"notas o null"}}
{"action":"cancel_appointment","appointmentId":"id_exacto","reason":"motivo mencionado por el cliente, o null"}
{"action":"reschedule_appointment","appointmentId":"id_exacto","newStartDate":"YYYY-MM-DDTHH:mm:ss","notes":"nota opcional o null"}
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
    console.error("[WaDialogue] el LLM orquestador no devolvió JSON válido:", raw);
    return null;
  }
}

// ─── Creación de la cita ─────────────────────────────────────────────────────

async function createAppointment(convo, org, agentData, orgAdminPhone, services) {
  const tz = org.timezone || "America/Bogota";
  const appointments = agentData.appointments || [];

  console.log(`[WaDialogue] (6) EJECUCIÓN — admin confirmó: creando ${appointments.length} cita(s) — conv: ${convo._id}`);

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

    console.log(`[WaDialogue] (6) EJECUCIÓN — ${appointments.length} cita(s) creada(s) exitosamente — conv: ${convo._id}`);
  } catch (err) {
    console.error(`[WaDialogue] (6) EJECUCIÓN — error creando cita(s) — conv: ${convo._id}:`, err.message);
    await sendTextMessage(
      orgAdminPhone,
      `❌ No pude crear la(s) cita(s): ${err.message}\nPor favor créalas manualmente en AgenditApp.`
    );
    await WaConversation.findByIdAndUpdate(convo._id, { status: "rejected" });
  }
}

// ─── Cancelación de cita existente ──────────────────────────────────────────

async function cancelAppointmentViaAgent(convo, org, agentData, orgAdminPhone, clientAppointments) {
  const tz = org.timezone || "America/Bogota";
  const target = clientAppointments.find((a) => a._id.toString() === agentData.appointmentId);
  const fecha = moment(target.startDate).tz(tz).format("ddd D/MM [a las] HH:mm");
  const resumen = `${target.service?.name || "?"} con ${target.employee?.names || "?"} el ${fecha}`;

  console.log(`[WaDialogue] (6) EJECUCIÓN — admin confirmó: cancelando cita ${agentData.appointmentId} (${resumen}) — conv: ${convo._id}`);

  try {
    const result = await cancellationService.cancelAppointment(
      agentData.appointmentId,
      "admin",
      agentData.reason || null,
      true // notifica al cliente — fue quien originó la solicitud
    );

    if (!result.success) {
      throw new Error(result.message);
    }

    await WaConversation.findByIdAndUpdate(convo._id, {
      status: "confirmed",
      appointmentId: agentData.appointmentId,
    });

    await sendTextMessage(orgAdminPhone, `✅ Cita cancelada\n${resumen}`);
    console.log(`[WaDialogue] (6) EJECUCIÓN — cita cancelada exitosamente — conv: ${convo._id}`);
  } catch (err) {
    console.error(`[WaDialogue] (6) EJECUCIÓN — error cancelando cita — conv: ${convo._id}:`, err.message);
    await sendTextMessage(
      orgAdminPhone,
      `❌ No pude cancelar la cita (${resumen}): ${err.message}\nPor favor cancélala manualmente en AgenditApp.`
    );
    await WaConversation.findByIdAndUpdate(convo._id, { status: "rejected" });
  }
}

// ─── Reprogramación de cita existente ───────────────────────────────────────

async function rescheduleAppointmentViaAgent(convo, org, agentData, orgAdminPhone, clientAppointments) {
  const tz = org.timezone || "America/Bogota";
  const target = clientAppointments.find((a) => a._id.toString() === agentData.appointmentId);
  const fechaActual = moment(target.startDate).tz(tz).format("ddd D/MM [a las] HH:mm");

  console.log(`[WaDialogue] (6) EJECUCIÓN — admin confirmó: reprogramando cita ${agentData.appointmentId} (de ${fechaActual} a ${agentData.newStartDate}) — conv: ${convo._id}`);

  const newStart = moment.tz(agentData.newStartDate, "YYYY-MM-DDTHH:mm:ss", tz);
  if (!newStart.isValid()) {
    await sendTextMessage(orgAdminPhone, `❌ La nueva fecha/hora "${agentData.newStartDate}" no es válida.`);
    return;
  }
  const fechaNueva = newStart.format("ddd D/MM [a las] HH:mm");
  const duracionMs = new Date(target.endDate).getTime() - new Date(target.startDate).getTime();
  const newEnd = new Date(newStart.toDate().getTime() + Math.max(duracionMs, 0));

  try {
    // Advertencia de solapamiento (informativa, no bloqueante) — mismo criterio
    // que usa el chatbot del admin en create_appointments
    const overlapping = await Appointment.find({
      _id: { $ne: agentData.appointmentId },
      employee: target.employee?._id,
      status: { $nin: CANCELLED_STATUSES },
      startDate: { $lt: newEnd },
      endDate: { $gt: newStart.toDate() },
    })
      .populate("client", "name")
      .populate("service", "name");

    const advertencia = overlapping.length
      ? `\n⚠️ ${target.employee?.names || "El profesional"} ya tiene cita(s) en ese horario: ` +
        overlapping.map((o) => `${o.service?.name || "?"} con ${o.client?.name || "?"} a las ${moment(o.startDate).tz(tz).format("HH:mm")}`).join(", ")
      : "";

    await appointmentService.updateAppointment(agentData.appointmentId, {
      startDate: newStart.format("YYYY-MM-DDTHH:mm:ss"),
      endDate: moment(newEnd).tz(tz).format("YYYY-MM-DDTHH:mm:ss"),
      organizationId: org._id,
      notes: agentData.notes || target.notes,
    });

    await WaConversation.findByIdAndUpdate(convo._id, {
      status: "confirmed",
      appointmentId: agentData.appointmentId,
    });

    await sendTextMessage(
      orgAdminPhone,
      `✅ Cita reprogramada\n${target.service?.name || "?"} con ${target.employee?.names || "?"}\nDe: ${fechaActual}\nA: ${fechaNueva}${advertencia}`
    );
    console.log(`[WaDialogue] (6) EJECUCIÓN — cita reprogramada exitosamente — conv: ${convo._id}`);
  } catch (err) {
    console.error(`[WaDialogue] (6) EJECUCIÓN — error reprogramando cita — conv: ${convo._id}:`, err.message);
    await sendTextMessage(
      orgAdminPhone,
      `❌ No pude reprogramar la cita (${fechaActual} → ${fechaNueva}): ${err.message}\nPor favor hazlo manualmente en AgenditApp.`
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

// Citas próximas (no canceladas) del cliente — le dan al LLM IDs reales para
// poder identificar a cuál se refiere cuando pide cancelar/reprogramar.
async function loadClientAppointments(clientPhone, orgId, timezone) {
  const client = await Client.findOne({
    organizationId: orgId,
    $or: [{ phone_e164: clientPhone }, { phoneNumber: clientPhone }],
  }).select("_id");
  if (!client) return [];

  const now = moment.tz(timezone).toDate();
  return Appointment.find({
    organizationId: orgId,
    client: client._id,
    status: { $nin: CANCELLED_STATUSES },
    startDate: { $gte: now },
  })
    .populate("service", "name")
    .populate("employee", "names")
    .sort({ startDate: 1 })
    .limit(10)
    .lean();
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

// Valida que el appointmentId que devolvió el LLM corresponda a una de las
// citas próximas reales del cliente (evita que actúe sobre IDs alucinados).
function validateAppointmentId(agentMessage, clientAppointments) {
  if (!agentMessage.appointmentId) return "No se especificó qué cita.";
  const found = clientAppointments.some((a) => a._id.toString() === agentMessage.appointmentId);
  if (!found) return `La cita "${agentMessage.appointmentId}" no está en la lista de citas próximas del cliente.`;
  return null;
}

async function sendAndRecord(convo, orgAdminPhone, message) {
  console.log(`[WaDialogue] (5) RESPUESTA — enviando a ${orgAdminPhone}: "${message.slice(0, 150)}" — conv: ${convo._id}`);
  const { messageId } = await sendTextMessage(orgAdminPhone, message);
  await WaConversation.findByIdAndUpdate(convo._id, {
    status: "summary_sent",
    metaMessageId: messageId,
    $push: { adminConversation: { role: "agent", body: message } },
  });
  console.log(`[WaDialogue] (5) RESPUESTA — mensaje enviado al admin — messageId: ${messageId} — conv: ${convo._id}`);
}
