import { processIncomingMessage, sanitizePhone } from "../services/waAgentService.js";
import { processAdminCommand } from "../services/waAgentChatService.js";
import { validateMetaSignature } from "../services/metaApiService.js";
import Organization from "../models/organizationModel.js";
import { disconnectOrg } from "../services/metaConnectService.js";

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
  if (changeObj?.field === "account_update" && change?.event === "PARTNER_REMOVED") {
    const phone = change.phone_number ? `+${String(change.phone_number).replace(/\D/g, "")}` : null;
    if (phone) {
      Organization.findOne({ metaPhone: phone })
        .then((org) => { if (org) return disconnectOrg(String(org._id)); })
        .then(() => console.log(`[WaAgent] PARTNER_REMOVED: org desconectada — ${phone}`))
        .catch((err) => console.error("[WaAgent] Error al desconectar org por PARTNER_REMOVED:", err));
    }
    return;
  }

  // Solo procesar texto e interactivos (botones de template); ignorar estados, imágenes, etc.
  if (!message || (message.type !== "text" && message.type !== "interactive")) return;

  const receivingPhoneNumberId = change?.metadata?.phone_number_id;
  const fromPhone = "+" + message.from.replace(/\D/g, "");

  // Para botones de template (quick_reply / button_reply) el texto está en interactive
  const body = message.type === "interactive"
    ? (message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? "")
    : (message.text?.body ?? "");

  if (!body || !fromPhone) return;

  // Ignorar eco de los propios mensajes salientes de AgenditApp
  if (process.env.META_AGENDITAPP_PHONE && fromPhone === process.env.META_AGENDITAPP_PHONE) {
    return;
  }

  // ── Routing ──────────────────────────────────────────────────────────────────
  if (receivingPhoneNumberId === process.env.META_PLATFORM_PHONE_NUMBER_ID) {
    // El admin escribió al número de AgenditApp → comando directo al bot
    const phoneVariants = [fromPhone, fromPhone.replace(/^\+/, "")];
    const org = await Organization.findOne({
      $or: [
        { phoneNumber: { $in: phoneVariants } },
        { waPhone: { $in: phoneVariants } },
      ],
      waAgentEnabled: true,
    }).lean();

    if (!org) {
      console.warn(`[WaAgent] Mensaje al número de AgenditApp desde teléfono no registrado como admin: ${fromPhone}`);
      return;
    }

    processAdminCommand(org, body).catch((err) =>
      console.error("[WaAgent] Error procesando comando del admin vía Meta:", err)
    );
  }
  // Mensajes de clientes a números Meta de orgs → no se procesan
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
  if (process.env.META_AGENDITAPP_PHONE && cleanClientPhone === process.env.META_AGENDITAPP_PHONE) {
    return;
  }

  processIncomingMessage({ orgPhone, fromMe, body }).catch((err) =>
    console.error("[WaAgent] Error procesando mensaje de Baileys:", err)
  );
}
