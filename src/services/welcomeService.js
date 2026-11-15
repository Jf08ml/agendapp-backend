import Organization from "../models/organizationModel.js";
import { sendMail } from "./mailService.js";
import { sendTemplateMessage } from "./metaApiService.js";
import { logOutboundMessage } from "./platformInboxService.js";
import { renderPlatformTemplate } from "./platformTemplateCatalog.js";
import { buildWelcomeEmail } from "../utils/emailTemplates/welcomeEmail.js";
import { cuentaCreadaComponents } from "../utils/panelLinks.js";
import { isRecipientAllowed } from "../utils/devRecipientGuard.js";

export const WELCOME_WA_TEMPLATE = "cuenta_creada";

/**
 * Bienvenida al dueño recién registrado por los dos canales: correo y WhatsApp
 * (plantilla `cuenta_creada` desde el número de la plataforma). Ambos llevan el
 * enlace de su panel, que es lo que le falta a quien sale del navegador de
 * Instagram/Facebook y ya no sabe cómo volver a entrar.
 *
 * Cada canal es independiente: si uno falla, el otro sale igual. El resultado
 * queda en Organization.welcomeDelivery para poder medirlo y, más adelante,
 * avisar en el panel cuando un dato de contacto no sirve. Nunca lanza.
 *
 * @param {{ _id, name: string, ownerName?: string, email: string, slug: string, phoneNumber?: string }} org
 */
export async function sendWelcomeMessages(org) {
  const data = {
    ownerName: org.ownerName || org.name,
    businessName: org.name,
    email: org.email,
    slug: org.slug,
  };

  const [emailResult, waResult] = await Promise.all([
    sendWelcomeEmail(org, data),
    sendWelcomeWhatsapp(org, data),
  ]);

  const now = new Date();
  const set = {};
  if (emailResult.ok) set["welcomeDelivery.emailSentAt"] = now;
  else if (emailResult.error) set["welcomeDelivery.emailError"] = emailResult.error;
  if (waResult.ok) set["welcomeDelivery.whatsappSentAt"] = now;
  else if (waResult.error) set["welcomeDelivery.whatsappError"] = waResult.error;

  if (Object.keys(set).length) {
    await Organization.updateOne({ _id: org._id }, { $set: set }).catch((err) =>
      console.error(`[welcome] No se pudo guardar el resultado (org=${org._id}):`, err?.message || err)
    );
  }
  return { email: emailResult, whatsapp: waResult };
}

async function sendWelcomeEmail(org, data) {
  const { subject, html, text } = buildWelcomeEmail(data);
  return sendMail({ to: org.email, subject, html, text });
}

async function sendWelcomeWhatsapp(org, data) {
  const phone = org.phoneNumber;
  if (!phone) return { ok: false, skipped: "no_phone" };
  if (!isRecipientAllowed(phone)) {
    console.log(`[welcome] (dev) ${phone} no está en DEV_NOTIFY_ALLOWLIST; no se envía ${WELCOME_WA_TEMPLATE}`);
    return { ok: false, skipped: "dev_not_allowed" };
  }

  try {
    const { messageId } = await sendTemplateMessage(phone, WELCOME_WA_TEMPLATE, "es", cuentaCreadaComponents(data));
    const params = [data.ownerName, data.businessName, data.email];
    logOutboundMessage({
      phone,
      organizationId: org._id,
      body: renderPlatformTemplate(WELCOME_WA_TEMPLATE, params) || `[Plantilla: ${WELCOME_WA_TEMPLATE}] ${params.join(" · ")}`,
      source: "welcome",
      templateName: WELCOME_WA_TEMPLATE,
      metaMessageId: messageId,
    }).catch((err) => console.error("[welcome] Error guardando el envío en el inbox:", err?.message || err));
    return { ok: true, messageId };
  } catch (err) {
    const metaError = err?.response?.data?.error;
    const error = metaError ? `${metaError.code}: ${metaError.message}` : String(err?.message || err);
    console.error(`[welcome] Error enviando ${WELCOME_WA_TEMPLATE} (org=${org._id}):`, error);
    return { ok: false, error: error.slice(0, 300) };
  }
}
