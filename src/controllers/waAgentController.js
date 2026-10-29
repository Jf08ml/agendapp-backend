import {
  processIncomingMessage,
  sanitizePhone,
} from "../services/waAgentService.js";
import { processAdminCommand } from "../services/waAgentChatService.js";
import { processClientBookingMessage, pauseForHumanTakeover } from "../services/waBookingAgentService.js";
import { validateMetaSignature } from "../services/metaApiService.js";
import Organization from "../models/organizationModel.js";
import PlatformWaMessage from "../models/platformWaMessageModel.js";
import { disconnectOrg } from "../services/metaConnectService.js";
import {
  logInboundMessage,
  logOutboundMessage,
  findOrganizationByPhone,
  updateMessageStatus,
} from "../services/platformInboxService.js";
import Appointment from "../models/appointmentModel.js";
import { isOptOutMessage, setOptOut } from "../services/oficinaOutreachService.js";

// Dedupe de webhooks: Meta puede reintentar la entrega del mismo mensaje.
// Map message.id → timestamp; se poda cada vez que crece.
const processedMessageIds = new Map();
const DEDUPE_TTL_MS = 10 * 60 * 1000;

function isDuplicateMessage(messageId) {
  if (!messageId) return false;
  const now = Date.now();
  if (processedMessageIds.size > 1000) {
    for (const [id, ts] of processedMessageIds.entries()) {
      if (now - ts > DEDUPE_TTL_MS) processedMessageIds.delete(id);
    }
  }
  if (processedMessageIds.has(messageId)) return true;
  processedMessageIds.set(messageId, now);
  return false;
}

// ─── Número de soporte y ventas (AgenditApp Oficina IA) ───────────────────────
// META_OFICINA_PHONE_NUMBER_ID: el número de AgenditApp para soporte, ventas y
// activación, conectado en coexistencia (sigue funcionando en el teléfono). Aquí
// no responde ningún bot: los mensajes quedan en el inbox de superadmin y la
// Oficina los lee. Lo que se escribe desde el teléfono llega como eco y también
// se guarda, para que la Oficina sepa que una persona ya habló con ese contacto.

function isOficinaNumber(phoneNumberId) {
  return Boolean(process.env.META_OFICINA_PHONE_NUMBER_ID) && phoneNumberId === process.env.META_OFICINA_PHONE_NUMBER_ID;
}

// Texto de un mensaje de cualquier tipo, para el inbox (fotos, audios... como marcador).
function messageBodyForInbox(message) {
  if (message.type === "text") return message.text?.body || "";
  if (message.type === "interactive") {
    return message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? "[respuesta]";
  }
  if (message.type === "button") return message.button?.text || "[botón]";
  const caption = message[message.type]?.caption;
  return `[${message.type || "mensaje"}]${caption ? ` ${caption}` : ""}`;
}

async function handleOficinaInbound(message) {
  if (isDuplicateMessage(message.id) || !message.from) return;
  const fromPhone = "+" + String(message.from).replace(/\D/g, "");
  const body = messageBodyForInbox(message);
  const org = await findOrganizationByPhone(fromPhone);
  await logInboundMessage({ phone: fromPhone, organizationId: org?._id || null, body, metaMessageId: message.id, line: "oficina" });
  if (org && isOptOutMessage(body)) {
    await setOptOut(String(org._id), true, "whatsapp");
    console.log(`[WaAgent] Org ${org._id} pidió no recibir mensajes (número de soporte)`);
  }
}

async function logOficinaEchoes(echoes) {
  for (const echo of echoes) {
    if (!echo?.to || isDuplicateMessage(echo.id)) continue;
    // Lo enviado por la API ya está guardado; el eco solo agrega lo escrito en el teléfono.
    if (echo.id && (await PlatformWaMessage.exists({ metaMessageId: echo.id }))) continue;
    const toPhone = "+" + String(echo.to).replace(/\D/g, "");
    const org = await findOrganizationByPhone(toPhone);
    await logOutboundMessage({
      phone: toPhone,
      organizationId: org?._id || null,
      body: messageBodyForInbox(echo),
      source: "manual",
      metaMessageId: echo.id || null,
      line: "oficina",
    });
  }
}

// ─── Meta Webhook ─────────────────────────────────────────────────────────────

/**
 * GET /api/wa-agent/meta-incoming
 * Meta llama esto una sola vez para verificar el webhook al configurarlo.
 */
export function handleMetaVerify(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    console.log("[WaAgent] Webhook de Meta verificado correctamente");
    return res.status(200).send(challenge);
  }

  console.warn("[WaAgent] Verificación de Meta fallida — token inválido");
  res.sendStatus(403);
}

/**
 * POST /api/wa-agent/meta-incoming
 * Recibe mensajes desde Meta Business API.
 * - Si llegan al número de plataforma de AgenditApp → comando del admin al bot
 * - Si llegan al número Meta de una org → ignorado (ya no monitoreamos clientes)
 */
export async function handleMetaIncoming(req, res) {
  // Meta exige 200 rápido o reintenta — respondemos antes de procesar
  res.status(200).json({ ok: true });

  // Validar firma HMAC (usa req.rawBody capturado en app.js)
  const signature = req.headers["x-hub-signature-256"];
  if (!validateMetaSignature(req.rawBody, signature)) {
    console.warn("[WaAgent] Firma HMAC de Meta inválida — payload ignorado");
    return;
  }

  // Meta envuelve todo en entry[].changes[].value
  const entry = req.body?.entry?.[0];
  const changeObj = entry?.changes?.[0];
  const change = changeObj?.value;
  const message = change?.messages?.[0];

  // account_update: cliente se desconectó de la API desde su WA Business App
  if (
    changeObj?.field === "account_update" &&
    change?.event === "PARTNER_REMOVED"
  ) {
    const phone = change.phone_number
      ? `+${String(change.phone_number).replace(/\D/g, "")}`
      : null;
    if (phone) {
      Organization.findOne({ metaPhone: phone })
        .then((org) => {
          if (org) return disconnectOrg(String(org._id));
        })
        .then(() =>
          console.log(`[WaAgent] PARTNER_REMOVED: org desconectada — ${phone}`),
        )
        .catch((err) =>
          console.error(
            "[WaAgent] Error al desconectar org por PARTNER_REMOVED:",
            err,
          ),
        );
    }
    return;
  }

  // smb_message_echoes (coexistencia): el negocio escribió desde su app de
  // WhatsApp Business. Si el agente de reservas está activo, se pausa para ese
  // cliente — una persona ya lo está atendiendo y el bot no debe pisarla.
  if (changeObj?.field === "smb_message_echoes") {
    const echoes = change?.message_echoes || [];
    const phoneNumberId = change?.metadata?.phone_number_id;
    if (!echoes.length || !phoneNumberId) return;
    if (isOficinaNumber(phoneNumberId)) {
      logOficinaEchoes(echoes).catch((err) =>
        console.error("[WaAgent] Error guardando mensajes enviados desde el teléfono de soporte:", err.message),
      );
      return;
    }
    Organization.findOne({ metaPhoneNumberId: phoneNumberId, waBookingAgentEnabled: true })
      .select("_id name")
      .lean()
      .then(async (org) => {
        if (!org) return;
        for (const echo of echoes) {
          if (!echo?.to) continue;
          const clientPhone = "+" + String(echo.to).replace(/\D/g, "");
          if (await pauseForHumanTakeover(String(org._id), clientPhone, echo.id)) {
            console.log(`[WaAgent] ${org.name} respondió a mano a ${clientPhone} — bot de reservas pausado para ese cliente`);
          }
        }
      })
      .catch((err) => console.error("[WaAgent] Error procesando smb_message_echoes:", err.message));
    return;
  }

  // Eventos de status (ticks: sent/delivered/read/failed) de mensajes salientes —
  // llegan en un payload separado, sin "messages". Actualiza el inbox de superadmin
  // y, para mensajes de las orgs (confirmaciones/recordatorios), la entrega real
  // en las citas vía biz_opaque_callback_data (= externalRef del envío).
  const statuses = change?.statuses;
  if (statuses?.length) {
    for (const s of statuses) {
      console.log(`[WaAgent] Status recibido de Meta: ${s.status} — ${s.id} (recipient ${s.recipient_id})`);
      updateMessageStatus({ metaMessageId: s.id, status: s.status }).catch((err) =>
        console.error("[WaAgent] Error actualizando status de mensaje:", err.message)
      );
      if (s.biz_opaque_callback_data) {
        const deliveryStatus = s.status === "read" ? "delivered" : s.status;
        const metaErr = s.errors?.[0];
        const errorText = metaErr
          ? `Meta no entregó el mensaje: ${metaErr.error_data?.details || metaErr.title || metaErr.message} (Meta ${metaErr.code})`
          : undefined;
        applyDeliveryStatus(s.biz_opaque_callback_data, deliveryStatus, errorText).catch((err) =>
          console.error("[WaAgent] Error actualizando entrega Meta en citas:", err.message)
        );
      }
    }
  }

  // Número de soporte y ventas (Oficina IA): todo va a su inbox, también fotos y audios.
  if (message && isOficinaNumber(change?.metadata?.phone_number_id)) {
    handleOficinaInbound(message).catch((err) =>
      console.error("[WaAgent] Error guardando mensaje entrante del número de soporte:", err.message),
    );
    return;
  }

  // Solo procesar texto e interactivos (botones de template); ignorar imágenes, etc.
  if (!message || (message.type !== "text" && message.type !== "interactive"))
    return;

  const receivingPhoneNumberId = change?.metadata?.phone_number_id;
  const fromPhone = "+" + message.from.replace(/\D/g, "");

  // Para botones de template (quick_reply / button_reply) el texto está en interactive
  const body =
    message.type === "interactive"
      ? (message.interactive?.button_reply?.title ??
        message.interactive?.list_reply?.title ??
        "")
      : (message.text?.body ?? "");

  if (!body || !fromPhone) return;

  // Ignorar reintentos de entrega del mismo mensaje
  if (isDuplicateMessage(message.id)) {
    console.log(`[WaAgent] Mensaje duplicado ignorado: ${message.id}`);
    return;
  }

  // Ignorar eco de los propios mensajes salientes de AgenditApp
  if (
    process.env.META_AGENDITAPP_PHONE &&
    fromPhone === process.env.META_AGENDITAPP_PHONE
  ) {
    return;
  }

  // ── Routing ──────────────────────────────────────────────────────────────────
  if (receivingPhoneNumberId === process.env.META_PLATFORM_PHONE_NUMBER_ID) {
    // Alguien escribió al número de AgenditApp (dueño de org o respuesta a un
    // mensaje de retargeting). Se persiste SIEMPRE para el inbox de superadmin,
    // sin importar si la org tiene el agente IA activado.
    const org = await findOrganizationByPhone(fromPhone);

    logInboundMessage({
      phone: fromPhone,
      organizationId: org?._id || null,
      body,
      metaMessageId: message.id,
    }).catch((err) => console.error("[WaAgent] Error guardando mensaje entrante en el inbox:", err.message));

    if (!org) {
      console.warn(
        `[WaAgent] Mensaje al número de AgenditApp desde teléfono no reconocido: ${fromPhone}`,
      );
      return;
    }

    // "Baja", "stop", "no me escriban"...: no se le vuelve a enviar nada desde
    // ningún número de AgenditApp (ni Oficina IA ni retargeting). Queda en el inbox para revisión.
    if (isOptOutMessage(body)) {
      setOptOut(String(org._id), true, "whatsapp").catch((err) =>
        console.error("[WaAgent] Error guardando la baja de mensajes:", err.message),
      );
      console.log(`[WaAgent] Org ${org._id} pidió no recibir mensajes del número de AgenditApp`);
      return;
    }

    if (!org.waAgentEnabled) {
      // Sin agente IA activo — queda pendiente en el inbox de superadmin para respuesta manual
      return;
    }

    processAdminCommand(org, body).catch((err) =>
      console.error(
        "[WaAgent] Error procesando comando del admin vía Meta:",
        err,
      ),
    );
    return;
  }

  // ── Mensajes de clientes al número Meta de una org ────────────────────────
  // Solo se procesan si la org activó el agente IA de reservas (default OFF).
  if (receivingPhoneNumberId) {
    const org = await Organization.findOne({
      metaPhoneNumberId: receivingPhoneNumberId,
      waConnectionType: "meta",
      waBookingAgentEnabled: true,
    }).lean();

    if (!org) return; // org sin agente de reservas activo — ignorar como antes

    // Ignorar mensajes del propio número del negocio (evita loops en coexistencia)
    if (org.metaPhone && fromPhone === org.metaPhone) return;

    processClientBookingMessage(org, fromPhone, body).catch((err) =>
      console.error("[WaAgent] Error procesando mensaje de cliente (booking):", err),
    );
  }
}

// ─── Baileys Webhook ──────────────────────────────────────────────────────────

/**
 * POST /api/wa-agent/message
 * Recibe mensajes desde el microservicio de Baileys.
 * Solo procesa mensajes del admin (fromMe: true).
 * Autenticado con shared secret en header X-WA-Agent-Secret.
 */
export async function handleBaileysMessage(req, res) {
  const secret = req.headers["x-wa-agent-secret"];
  if (!secret || secret !== process.env.WA_AGENT_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Responder inmediatamente — Baileys no debe esperar el procesamiento
  res.status(200).json({ ok: true });

  const { orgPhone, clientPhone, fromMe, body } = req.body;

  const cleanClientPhone = sanitizePhone(clientPhone); // strip @lid, @s.whatsapp.net, etc.

  if (!orgPhone || !body) {
    console.warn("[WaAgent] Payload incompleto — ignorado");
    return;
  }

  // Ignorar mensajes donde el "cliente" es el propio número de AgenditApp
  if (
    process.env.META_AGENDITAPP_PHONE &&
    cleanClientPhone === process.env.META_AGENDITAPP_PHONE
  ) {
    return;
  }

  // Baileys es solo canal de notificaciones salientes — mensajes entrantes se ignoran
}

// Orden de progreso de los acks de entrega — un ack tardío no puede retroceder
// un estado ya más avanzado (mismo criterio que platformInboxService.updateMessageStatus,
// pero sin "read": no nos interesa si el cliente vio el mensaje).
const DELIVERY_STATUS_RANK = { failed: 1, sent: 1, delivered: 2 };

// externalRef viaja como "<kind>:<id1>,<id2>,..." — un recordatorio puede
// agrupar varias citas del mismo cliente/teléfono en un solo mensaje.
// El aviso de reprogramación es la confirmación vigente del nuevo horario
// (rescheduleNotifier lo registra como confirmación), así que comparte campos.
const CONFIRMATION_FIELDS = {
  statusField: "waConfirmationDeliveryStatus",
  updatedAtField: "waConfirmationDeliveryUpdatedAt",
  errorField: "waConfirmationError",
};
const REF_KIND_FIELDS = {
  confirmation: CONFIRMATION_FIELDS,
  reschedule: CONFIRMATION_FIELDS,
  reminder: { statusField: "reminderDeliveryStatus", updatedAtField: "reminderDeliveryUpdatedAt" },
  reminder2: { statusField: "secondReminderDeliveryStatus", updatedAtField: "secondReminderDeliveryUpdatedAt" },
};

/**
 * Aplica un ack de entrega ("sent"/"delivered"/"failed") a las citas del
 * externalRef, sin retroceder un estado ya más avanzado. Lo usan los acks de
 * Baileys (handleBaileysStatus) y los status de Meta (biz_opaque_callback_data).
 */
async function applyDeliveryStatus(externalRef, status, errorText) {
  if (!externalRef || !DELIVERY_STATUS_RANK[status]) return;

  const sepIndex = externalRef.indexOf(":");
  if (sepIndex === -1) return;

  const kind = externalRef.slice(0, sepIndex);
  const fields = REF_KIND_FIELDS[kind];
  if (!fields) {
    console.warn(`[WaAgent] externalRef con kind desconocido: ${kind}`);
    return;
  }

  const appointmentIds = externalRef.slice(sepIndex + 1).split(",").filter(Boolean);
  if (!appointmentIds.length) return;

  const appointments = await Appointment.find({ _id: { $in: appointmentIds } })
    .select(fields.statusField)
    .lean();

  const toUpdateIds = appointments
    .filter((a) => {
      const current = a[fields.statusField];
      return !current || DELIVERY_STATUS_RANK[status] >= DELIVERY_STATUS_RANK[current];
    })
    .map((a) => a._id);

  if (!toUpdateIds.length) return;

  const $set = { [fields.statusField]: status, [fields.updatedAtField]: new Date() };
  if (status === "failed" && errorText && fields.errorField) {
    $set[fields.errorField] = String(errorText).slice(0, 500);
  }
  await Appointment.updateMany({ _id: { $in: toUpdateIds } }, { $set });
}

/**
 * POST /api/wa-agent/status
 * Recibe acks reales de entrega (SERVER_ACK/DELIVERY_ACK de Baileys, ya
 * traducidos a "sent"/"delivered"/"failed") correlacionados por el externalRef
 * que viajó en el envío original (ver sendWhatsappService.js/appointmentService.js).
 * Autenticado con el mismo shared secret que /api/wa-agent/message.
 */
export async function handleBaileysStatus(req, res) {
  const secret = req.headers["x-wa-agent-secret"];
  if (!secret || secret !== process.env.WA_AGENT_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Responder inmediatamente — el microservicio no debe esperar el procesamiento
  res.status(200).json({ ok: true });

  const { externalRef, status } = req.body || {};

  try {
    await applyDeliveryStatus(externalRef, status);
  } catch (err) {
    console.error("[WaAgent] Error actualizando status de entrega Baileys:", err.message);
  }
}
