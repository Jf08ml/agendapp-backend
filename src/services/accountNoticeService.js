import moment from "moment-timezone";
import { sendMail } from "./mailService.js";
import { sendTemplateMessage } from "./metaApiService.js";
import { logOutboundMessage } from "./platformInboxService.js";
import { renderPlatformTemplate } from "./platformTemplateCatalog.js";
import { buildPasswordChangedEmail } from "../utils/emailTemplates/accessEmails.js";
import { ACCOUNT_NOTICE_WA_TEMPLATE, avisoCuentaComponents } from "../utils/accountAccess.js";
import { ACCESS_WA_LINE } from "../utils/panelLinks.js";
import { isRecipientAllowed } from "../utils/devRecipientGuard.js";

/**
 * Avisa al dueño que la contraseña de su panel cambió: correo + WhatsApp
 * (`aviso_cuenta`, número Oficina IA). Cada canal va por su lado; nunca lanza.
 * Si el correo rebotó, el WhatsApp es el que avisa.
 *
 * @param {{ _id, name: string, ownerName?: string, email: string, phoneNumber?: string, timezone?: string }} org
 */
export async function notifyPasswordChanged(org) {
  const tz = org.timezone && org.timezone !== "UTC" ? org.timezone : "America/Bogota";
  const when = moment().tz(tz).locale("es").format("D [de] MMMM [a las] h:mm a");
  const data = { ownerName: org.ownerName || org.name, businessName: org.name, email: org.email, when };

  const [email, whatsapp] = await Promise.all([
    sendMail({ to: org.email, ...buildPasswordChangedEmail(data) }),
    sendNoticeWhatsapp(org, data),
  ]);
  if (!email.ok && email.error) console.error(`[accountNotice] Correo (org=${org._id}):`, email.error);
  return { email, whatsapp };
}

async function sendNoticeWhatsapp(org, data) {
  const phone = org.phoneNumber;
  if (!phone) return { ok: false, skipped: "no_phone" };
  if (!isRecipientAllowed(phone)) return { ok: false, skipped: "dev_not_allowed" };
  try {
    const { messageId } = await sendTemplateMessage(
      phone,
      ACCOUNT_NOTICE_WA_TEMPLATE,
      "es",
      avisoCuentaComponents(data),
      ACCESS_WA_LINE
    );
    logOutboundMessage({
      phone,
      organizationId: org._id,
      body:
        renderPlatformTemplate(ACCOUNT_NOTICE_WA_TEMPLATE, [data.ownerName, data.businessName, data.when]) ||
        `[Plantilla: ${ACCOUNT_NOTICE_WA_TEMPLATE}] ${data.businessName} · ${data.when}`,
      source: "access",
      templateName: ACCOUNT_NOTICE_WA_TEMPLATE,
      metaMessageId: messageId,
      line: ACCESS_WA_LINE,
    }).catch(() => {});
    return { ok: true, messageId };
  } catch (err) {
    const metaError = err?.response?.data?.error;
    const error = metaError ? `${metaError.code}: ${metaError.message}` : String(err?.message || err);
    console.error(`[accountNotice] ${ACCOUNT_NOTICE_WA_TEMPLATE} (org=${org._id}):`, error);
    return { ok: false, error: error.slice(0, 300) };
  }
}
