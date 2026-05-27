import { processIncomingMessage, processOrgResponse, sanitizePhone } from "../services/waAgentService.js";
import { validateMetaSignature } from "../services/metaApiService.js";
import Organization from "../models/organizationModel.js";

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
 * Recibe mensajes de respuesta de la org desde Meta Business API.
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
  const change = entry?.changes?.[0]?.value;
  const message = change?.messages?.[0];

  // Ignorar notificaciones de estado (delivered, read, etc.) — solo procesar texto
  if (!message || message.type !== "text") return;

  const receivingPhoneNumberId = change?.metadata?.phone_number_id;
  const fromPhone = "+" + message.from.replace(/\D/g, "");
  const body = message.text?.body ?? "";

  if (!body || !fromPhone) return;

  // ── Routing: ¿es respuesta del admin a AgenditApp, o mensaje de cliente a org Meta? ──
  if (receivingPhoneNumberId === process.env.META_PHONE_NUMBER_ID) {
    // Respuesta del admin al bot de AgenditApp
    // Primero intentar continuar un diálogo activo; si no hay ninguno, es confirmación
    // de agente_ia_activo → actualizar ventana a nivel de org
    processOrgResponse({ orgPhone: fromPhone, body }).catch((err) =>
      console.error("[WaAgent] Error procesando respuesta de org:", err)
    );

    // Registrar contacto a nivel de org para la ventana de 24h
    // (aplica tanto para respuestas a agente_ia_activo como a cualquier reply del admin)
    const phoneVariants = [fromPhone, fromPhone.replace(/^\+/, "")];
    Organization.findOneAndUpdate(
      { phoneNumber: { $in: phoneVariants } },
      { agentAdminLastContactAt: new Date() }
    ).catch((err) => console.error("[WaAgent] Error actualizando agentAdminLastContactAt:", err));
  } else {
    // Mensaje de cliente al número Meta de una org → detectar intención
    const org = await Organization.findOne({ metaPhoneNumberId: receivingPhoneNumberId }).lean();
    if (!org) {
      console.warn(`[WaAgent] metaPhoneNumberId no registrado: ${receivingPhoneNumberId}`);
      return;
    }
    if (!org.waAgentEnabled) return;

    processIncomingMessage({
      orgPhone: org.metaPhone || receivingPhoneNumberId,
      clientPhone: fromPhone,
      fromMe: false,
      body,
      timestamp: message.timestamp,
    }).catch((err) => console.error("[WaAgent] Error procesando mensaje Meta entrante:", err));
  }
}

// ─── Baileys Webhook ──────────────────────────────────────────────────────────

/**
 * POST /api/wa-agent/message
 * Recibe mensajes desde el microservicio de Baileys.
 * Autenticado con shared secret en header X-WA-Agent-Secret.
 */
export async function handleBaileysMessage(req, res) {
  const secret = req.headers["x-wa-agent-secret"];
  if (!secret || secret !== process.env.WA_AGENT_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Responder inmediatamente — Baileys no debe esperar el procesamiento
  res.status(200).json({ ok: true });

  const { orgPhone, clientPhone, fromMe, body, timestamp } = req.body;

  const cleanClientPhone = sanitizePhone(clientPhone); // strip @lid, @s.whatsapp.net, etc.

  console.log("[WaAgent] Payload recibido de Baileys:", { orgPhone, clientPhone: cleanClientPhone, fromMe, body: body?.slice(0, 50) });

  if (!orgPhone || !cleanClientPhone || !body) {
    console.warn("[WaAgent] Payload incompleto — ignorado");
    return;
  }

  // Ignorar mensajes donde el "cliente" es el propio número de AgenditApp
  // (Baileys lee los mensajes que AgenditApp le envía a la org como mensajes entrantes)
  if (process.env.META_AGENDITAPP_PHONE && cleanClientPhone === process.env.META_AGENDITAPP_PHONE) {
    return;
  }

  processIncomingMessage({ orgPhone, clientPhone: cleanClientPhone, fromMe, body, timestamp }).catch((err) =>
    console.error("[WaAgent] Error procesando mensaje de Baileys:", err)
  );
}
