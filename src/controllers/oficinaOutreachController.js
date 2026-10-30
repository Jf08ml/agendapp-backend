import {
  getDeliveryStatuses,
  listMessagesForOficina,
  listOrganizationsForOficina,
  OutreachBlocked,
  OutreachNotConfigured,
  sendForOficina,
  setOptOut,
} from "../services/oficinaOutreachService.js";

/**
 * Rutas de AgenditApp Oficina IA para el trabajador de activación. Todas pasan
 * por el middleware oficinaSignature. Errores: { error: { code, message, retriable? } }.
 * - 409: una regla impidió el envío (baja, ventana de 24 h, plantilla cambiada...).
 * - 502: WhatsApp rechazó el envío (no salió).
 */

const OBJECT_ID = /^[a-f0-9]{24}$/;
const MESSAGE_ID = /^ofi:[a-f0-9]{24}:[a-f0-9]{12}$/;
const TEMPLATE_NAME = /^[a-z0-9_]{1,64}$/;

const bad = (res, message) => res.status(400).json({ error: { code: "invalid_request", message } });

export async function getOrganizations(req, res) {
  try {
    const ids = typeof req.query.ids === "string" && req.query.ids ? req.query.ids.split(",") : undefined;
    if (ids && (ids.length > 100 || ids.some((id) => !OBJECT_ID.test(id)))) return bad(res, "ids inválidos");
    // all=1: todos los negocios (hasta el máximo), sin importar cuándo se registraron.
    const all = req.query.all === "1";
    const days = req.query.createdSinceDays === undefined ? 45 : Number(req.query.createdSinceDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return bad(res, "createdSinceDays debe estar entre 1 y 3650");
    return res.json(await listOrganizationsForOficina({ ids, createdSinceDays: days, all }));
  } catch (err) {
    console.error("[oficinaOutreach] getOrganizations:", err.message);
    return res.status(500).json({ error: { code: "internal", message: "Error interno" } });
  }
}

export async function getMessages(req, res) {
  try {
    if (!OBJECT_ID.test(req.params.id)) return bad(res, "id inválido");
    const limit = req.query.limit === undefined ? 15 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) return bad(res, "limit debe estar entre 1 y 50");
    return res.json({ messages: await listMessagesForOficina(req.params.id, limit) });
  } catch (err) {
    console.error("[oficinaOutreach] getMessages:", err.message);
    return res.status(500).json({ error: { code: "internal", message: "Error interno" } });
  }
}

function parseSend(body) {
  if (!body || typeof body !== "object") return null;
  const { messageId, organizationId, channel, preview } = body;
  if (typeof messageId !== "string" || !MESSAGE_ID.test(messageId)) return null;
  if (typeof organizationId !== "string" || !OBJECT_ID.test(organizationId)) return null;
  if (typeof preview !== "string" || preview.length < 1 || preview.length > 2000) return null;
  if (channel?.kind === "text") {
    if (typeof channel.text !== "string" || channel.text.trim().length < 2 || channel.text.length > 1000) return null;
    return { messageId, organizationId, preview, channel: { kind: "text", text: channel.text } };
  }
  if (channel?.kind === "template") {
    const { templateName, params } = channel;
    if (typeof templateName !== "string" || !TEMPLATE_NAME.test(templateName)) return null;
    if (!Array.isArray(params) || params.length > 10 || params.some((p) => typeof p !== "string" || p.length > 500)) return null;
    return { messageId, organizationId, preview, channel: { kind: "template", templateName, params } };
  }
  return null;
}

export async function postSend(req, res) {
  const input = parseSend(req.body);
  if (!input) return bad(res, "Cuerpo inválido");
  try {
    return res.json(await sendForOficina(input));
  } catch (err) {
    if (err instanceof OutreachBlocked) return res.status(409).json({ error: { code: err.code, message: err.message } });
    // No salió nada: la Oficina lo registra como error que se puede reintentar.
    if (err instanceof OutreachNotConfigured) return res.status(422).json({ error: { code: err.code, message: err.message, retriable: true } });
    if (err.whatsapp) return res.status(502).json({ error: { code: "whatsapp_error", message: err.message, retriable: Boolean(err.retriable) } });
    console.error("[oficinaOutreach] postSend:", input.messageId, err.message);
    return res.status(500).json({ error: { code: "internal", message: "Error interno; no se sabe si el mensaje salió" } });
  }
}

// POST y no GET: hasta 100 messageIds no caben con holgura en la URL. Solo lee.
export async function postDeliveryStatus(req, res) {
  try {
    const ids = req.body?.messageIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || ids.some((id) => typeof id !== "string" || !MESSAGE_ID.test(id))) {
      return bad(res, "messageIds debe ser una lista de 1 a 100 ids válidos");
    }
    return res.json({ statuses: await getDeliveryStatuses(ids) });
  } catch (err) {
    console.error("[oficinaOutreach] postDeliveryStatus:", err.message);
    return res.status(500).json({ error: { code: "internal", message: "Error interno" } });
  }
}

export async function postOptOut(req, res) {
  try {
    if (!OBJECT_ID.test(req.params.id)) return bad(res, "id inválido");
    if (typeof req.body?.optedOut !== "boolean") return bad(res, "optedOut debe ser true o false");
    const found = await setOptOut(req.params.id, req.body.optedOut, "oficina");
    if (!found) return res.status(404).json({ error: { code: "not_found", message: "El negocio no existe" } });
    return res.json({ organizationId: req.params.id, optedOut: req.body.optedOut });
  } catch (err) {
    console.error("[oficinaOutreach] postOptOut:", err.message);
    return res.status(500).json({ error: { code: "internal", message: "Error interno" } });
  }
}
