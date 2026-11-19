import { BRAND } from "./welcomeEmail.js";
import { ACCESS_CODE_TTL_MINUTES } from "../accountAccess.js";

// Correos de la recuperación de acceso: el código (con enlace directo) y el
// aviso de que cambió la contraseña. Mismo marco visual que el de bienvenida:
// tablas y estilos en línea, máximo 560 px.

const FONT = "'Poppins','Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const escapeHtml = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function frame({ subject, preheader, inner, footerNote }) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <tr><td align="center" style="padding:0 0 20px;">
          <a href="${BRAND.siteUrl}" style="text-decoration:none;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td valign="middle" style="padding-right:10px;"><img src="${BRAND.logoUrl}" width="40" height="40" alt="AgenditApp" style="display:block;border:0;"></td>
              <td valign="middle" style="font-family:${FONT};font-size:22px;font-weight:700;color:${BRAND.navy};letter-spacing:-0.3px;">AgenditApp</td>
            </tr></table>
          </a>
        </td></tr>
        <tr><td style="background:#ffffff;border-radius:14px;border:1px solid ${BRAND.border};overflow:hidden;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="height:6px;background:${BRAND.blue};font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr><td style="padding:32px;font-family:${FONT};">${inner}</td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:22px 16px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${BRAND.muted};">
          El equipo de AgenditApp · <a href="${BRAND.siteUrl}" style="color:${BRAND.muted};">agenditapp.com</a><br>
          ${escapeHtml(footerNote)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const button = (url, label) => `
              <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:24px auto 8px;">
                <tr><td align="center" bgcolor="${BRAND.blue}" style="border-radius:10px;">
                  <a href="${escapeHtml(url)}" style="display:inline-block;padding:15px 34px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
                </td></tr>
              </table>`;

/**
 * Código para recuperar el acceso, con botón que lo aplica solo.
 * @param {{ ownerName?: string, businessName: string, code: string, link: string }} data
 */
export function buildAccessCodeEmail({ ownerName, businessName, code, link }) {
  const name = String(ownerName || "").trim();
  const greeting = name ? `Hola, ${name}` : "Hola";
  const subject = `${code} es tu código para entrar a AgenditApp`;
  const preheader = `Úsalo para entrar al panel de ${businessName}. Vence en ${ACCESS_CODE_TTL_MINUTES} minutos.`;

  const text = [
    `${greeting}:`,
    "",
    `Pediste entrar al panel de ${businessName} en AgenditApp sin tu contraseña.`,
    "",
    `Tu código es: ${code}`,
    `O entra directo con este enlace: ${link}`,
    "",
    `El código vence en ${ACCESS_CODE_TTL_MINUTES} minutos y sirve una sola vez.`,
    "Si no fuiste tú, ignora este correo: nadie puede entrar sin este código.",
    "",
    "El equipo de AgenditApp",
  ].join("\n");

  const inner = `
              <h1 style="margin:0 0 10px;font-size:22px;line-height:1.3;color:${BRAND.heading};">${escapeHtml(greeting)}</h1>
              <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:${BRAND.body};">Pediste entrar al panel de <strong style="color:${BRAND.heading};">${escapeHtml(businessName)}</strong> sin tu contraseña. Este es tu código:</p>
              <div style="background:${BRAND.soft};border-radius:12px;padding:18px;text-align:center;font-family:${FONT};font-size:34px;font-weight:700;letter-spacing:10px;color:${BRAND.navy};">${escapeHtml(code)}</div>
              ${button(link, "Entrar a mi panel")}
              <p style="margin:16px 0 0;text-align:center;font-size:13px;line-height:1.6;color:${BRAND.muted};">El código vence en ${ACCESS_CODE_TTL_MINUTES} minutos y sirve una sola vez.<br>Si no fuiste tú, ignora este correo: nadie puede entrar sin este código.</p>`;

  return {
    subject,
    text,
    html: frame({ subject, preheader, inner, footerNote: "Recibes este correo porque alguien pidió entrar a tu cuenta de AgenditApp." }),
  };
}

/**
 * Aviso de que la contraseña del panel cambió.
 * @param {{ ownerName?: string, businessName: string, email: string, when: string }} data
 */
export function buildPasswordChangedEmail({ ownerName, businessName, email, when }) {
  const name = String(ownerName || "").trim();
  const greeting = name ? `Hola, ${name}` : "Hola";
  const subject = `Cambió la contraseña de ${businessName} en AgenditApp`;
  const preheader = `Si fuiste tú, no tienes que hacer nada.`;

  const text = [
    `${greeting}:`,
    "",
    `La contraseña del panel de ${businessName} en AgenditApp cambió el ${when}.`,
    `Correo de ingreso: ${email}`,
    "",
    "Si fuiste tú, no tienes que hacer nada.",
    `Si no reconoces este cambio, escríbenos de inmediato por WhatsApp: ${BRAND.supportWaUrl}`,
    "",
    "El equipo de AgenditApp",
  ].join("\n");

  const inner = `
              <h1 style="margin:0 0 10px;font-size:22px;line-height:1.3;color:${BRAND.heading};">${escapeHtml(greeting)}</h1>
              <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:${BRAND.body};">La contraseña del panel de <strong style="color:${BRAND.heading};">${escapeHtml(businessName)}</strong> cambió el <strong style="color:${BRAND.heading};">${escapeHtml(when)}</strong>.</p>
              <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:${BRAND.body};">Correo de ingreso: <strong style="color:${BRAND.heading};">${escapeHtml(email)}</strong></p>
              <p style="margin:0;font-size:15px;line-height:1.6;color:${BRAND.body};">Si fuiste tú, no tienes que hacer nada. Si no reconoces este cambio, <a href="${BRAND.supportWaUrl}" style="color:${BRAND.blue};text-decoration:none;font-weight:600;">escríbenos de inmediato por WhatsApp</a>.</p>`;

  return {
    subject,
    text,
    html: frame({ subject, preheader, inner, footerNote: "Te avisamos de cada cambio de contraseña de tu cuenta de AgenditApp." }),
  };
}
