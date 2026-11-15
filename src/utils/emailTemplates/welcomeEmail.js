import { panelLoginUrl } from "../panelLinks.js";

const escapeHtml = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Correo de bienvenida al dueño recién registrado: su enlace de acceso al panel
 * y el correo con el que entra. Es el lugar al que vuelve cuando sale del
 * navegador de Instagram/Facebook y ya no tiene la sesión.
 *
 * @param {{ ownerName?: string, businessName: string, email: string, slug: string }} data
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildWelcomeEmail({ ownerName, businessName, email, slug }) {
  const url = panelLoginUrl(slug);
  const name = (ownerName || businessName || "").trim();
  const greeting = name ? `¡Hola, ${name}!` : "¡Hola!";
  const subject = `Tu cuenta de ${businessName} en AgenditApp está lista`;

  const text = [
    greeting,
    "",
    `La cuenta de ${businessName} en AgenditApp quedó creada.`,
    "",
    `Entra a tu panel aquí: ${url}`,
    `Inicia sesión con este correo (${email}) y la contraseña que creaste al registrarte.`,
    "",
    "Guarda este correo: aquí siempre tendrás el enlace de tu panel.",
    "Si tienes dudas, responde a este correo y te ayudamos.",
    "",
    "El equipo de AgenditApp",
  ].join("\n");

  const html = `<!doctype html>
<html lang="es">
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px 28px;">
        <tr><td>
          <h1 style="margin:0 0 16px;font-size:22px;color:#1C3461;">${escapeHtml(greeting)}</h1>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">La cuenta de <strong>${escapeHtml(businessName)}</strong> en AgenditApp quedó creada.</p>
          <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">Inicia sesión con este correo (<strong>${escapeHtml(email)}</strong>) y la contraseña que creaste al registrarte.</p>
          <p style="margin:0 0 24px;text-align:center;">
            <a href="${escapeHtml(url)}" style="display:inline-block;background:#1D4ED8;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:10px;">Entrar a mi panel</a>
          </p>
          <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#555;">Si el botón no funciona, copia este enlace en tu navegador:</p>
          <p style="margin:0 0 24px;font-size:14px;word-break:break-all;"><a href="${escapeHtml(url)}" style="color:#1D4ED8;">${escapeHtml(url)}</a></p>
          <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#555;">Guarda este correo: aquí siempre tendrás el enlace de tu panel. Si tienes dudas, responde a este correo y te ayudamos.</p>
          <p style="margin:16px 0 0;font-size:14px;color:#555;">El equipo de AgenditApp</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
