import nodemailer from "nodemailer";
import { isRecipientAllowed } from "../utils/devRecipientGuard.js";

// Envío de correo transaccional por SMTP (hoy: el buzón hola@agenditapp.com de
// Hostinger). Todo el envío pasa por aquí para poder cambiar de proveedor
// (Resend, Brevo, SES…) tocando solo este archivo.
//
// Variables: SMTP_HOST, SMTP_PORT (465 = SSL), SMTP_USER, SMTP_PASS, MAIL_FROM.

let transporter = null;

export function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT) || 465;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
}

/**
 * Envía un correo. Nunca lanza: devuelve el resultado para que el caller lo
 * registre sin romper el flujo principal (registro, login…).
 *
 * @param {{ to: string, subject: string, html: string, text: string, replyTo?: string }} mail
 * @returns {Promise<{ ok: boolean, messageId?: string, skipped?: string, error?: string }>}
 */
export async function sendMail({ to, subject, html, text, replyTo }) {
  if (!to) return { ok: false, skipped: "no_recipient" };
  if (!isMailConfigured()) {
    console.warn("[mail] SMTP no configurado; no se envía:", subject);
    return { ok: false, skipped: "not_configured" };
  }
  if (!isRecipientAllowed(to)) {
    console.log(`[mail] (dev) ${to} no está en DEV_NOTIFY_ALLOWLIST; no se envía: ${subject}`);
    return { ok: false, skipped: "dev_not_allowed" };
  }

  try {
    const from = process.env.MAIL_FROM || process.env.SMTP_USER;
    const info = await getTransporter().sendMail({
      from,
      to,
      subject,
      html,
      text,
      replyTo: replyTo || from,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error("[mail] Error enviando correo:", err?.message || err);
    return { ok: false, error: String(err?.message || err).slice(0, 300) };
  }
}
