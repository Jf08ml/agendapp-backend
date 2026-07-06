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
 * @param {Array} [components] - Componentes con parámetros (ej: [{ type: "body", parameters: [...] }])
 * @returns {Promise<{ messageId: string }>}
 */
export async function sendTemplateMessage(toPhone, templateName, languageCode = "es", components = []) {
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
        ...(components.length > 0 && { components }),
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
 * Atajo para plantillas de la plataforma con solo variables de BODY en texto.
 * Meta rechaza parámetros con saltos de línea/tabs, así que se colapsan a
 * espacios (ej. direcciones escritas en textarea).
 * @param {string} toPhone
 * @param {string} templateName
 * @param {Array<string|number>} textParams - en el orden de {{1}}..{{n}}
 */
export async function sendPlatformTemplate(toPhone, templateName, textParams = []) {
  const components = textParams.length
    ? [{
        type: "body",
        parameters: textParams.map((t) => ({
          type: "text",
          text: String(t).replace(/\s+/g, " ").trim() || "—",
        })),
      }]
    : [];
  return sendTemplateMessage(toPhone, templateName, "es", components);
}

// ── Notificación interna: nuevo registro ────────────────────────────────────

const NEW_SIGNUP_NOTIFY_PHONE = process.env.WHATSAPP_NEW_SIGNUP_NOTIFY_PHONE;
const NEW_SIGNUP_TEMPLATE_NAME = "nuevo_registro";

/**
 * Notifica al WhatsApp de contacto de AgenditApp (WHATSAPP_NEW_SIGNUP_NOTIFY_PHONE)
 * cuando una nueva organización se registra en la plataforma.
 *
 * Requiere una plantilla aprobada por Meta llamada "nuevo_registro" con un
 * componente BODY de 4 variables en este orden: nombre del negocio, nombre
 * del dueño, teléfono, email. Si la plantilla no existe o no está aprobada,
 * Meta devuelve error y este helper solo lo registra (no afecta el registro).
 *
 * @param {{ businessName: string, ownerName?: string, phone: string, email: string }} data
 */
export async function notifyNewRegistration({ businessName, ownerName, phone, email }) {
  if (!NEW_SIGNUP_NOTIFY_PHONE) {
    console.warn(
      "[metaApi] WHATSAPP_NEW_SIGNUP_NOTIFY_PHONE no configurado en este entorno; no se envía la notificación de nuevo registro."
    );
    return;
  }

  try {
    const { messageId } = await sendTemplateMessage(NEW_SIGNUP_NOTIFY_PHONE, NEW_SIGNUP_TEMPLATE_NAME, "es", [
      {
        type: "body",
        parameters: [
          { type: "text", text: businessName },
          { type: "text", text: ownerName || businessName },
          { type: "text", text: phone },
          { type: "text", text: email },
        ],
      },
    ]);
    console.log(`[metaApi] Notificación de nuevo registro enviada (msg ${messageId}) — negocio "${businessName}".`);
  } catch (err) {
    console.error("[metaApi] Error notificando nuevo registro:", err.response?.data || err.message);
  }
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
