import axios from "axios";
import { createHmac, timingSafeEqual } from "crypto";

const GRAPH_URL = "https://graph.facebook.com/v25.0";

function getConfig() {
  return {
    phoneNumberId: process.env.META_PLATFORM_PHONE_NUMBER_ID,
    accessToken: process.env.META_PLATFORM_ACCESS_TOKEN,
  };
}

/**
 * Envía un mensaje de texto desde el número de AgenditApp al número destino.
 * @param {string} toPhone - Número E.164 del destinatario (ej: "+573001234567")
 * @param {string} text - Texto a enviar
 * @returns {Promise<{ messageId: string }>}
 */
export async function sendTextMessage(toPhone, text) {
  const { phoneNumberId, accessToken } = getConfig();

  const response = await axios.post(
    `${GRAPH_URL}/${phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      to: toPhone,
      type: "text",
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  const messageId = response.data?.messages?.[0]?.id;
  return { messageId };
}

/**
 * Envía un mensaje de plantilla aprobada por Meta.
 * @param {string} toPhone - Número E.164 del destinatario
 * @param {string} templateName - Nombre exacto de la plantilla en Meta Business
 * @param {string} languageCode - Código de idioma de la plantilla (default: "es")
 * @returns {Promise<{ messageId: string }>}
 */
export async function sendTemplateMessage(toPhone, templateName, languageCode = "es") {
  const { phoneNumberId, accessToken } = getConfig();

  const response = await axios.post(
    `${GRAPH_URL}/${phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      to: toPhone,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
      },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  const messageId = response.data?.messages?.[0]?.id;
  return { messageId };
}

/**
 * Valida la firma HMAC-SHA256 que Meta incluye en cada webhook POST.
 * Usa req.rawBody que ya se captura en app.js.
 * @param {string} rawBody
 * @param {string} signatureHeader - valor de X-Hub-Signature-256
 * @returns {boolean}
 */
export function validateMetaSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !process.env.META_APP_SECRET) return false;

  const expected = "sha256=" + createHmac("sha256", process.env.META_APP_SECRET)
    .update(rawBody)
    .digest("hex");

  // timingSafeEqual evita timing attacks
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}
