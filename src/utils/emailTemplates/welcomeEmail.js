import { MAIN_DOMAIN, panelLoginUrl } from "../panelLinks.js";

// Identidad de AgenditApp (la misma de agenditapp.com). El logo se sirve desde la
// landing: los correos no pueden usar archivos locales ni SVG (Gmail no los muestra).
export const BRAND = {
  logoUrl: `https://${MAIN_DOMAIN}/icono-full-blue.png`,
  siteUrl: `https://${MAIN_DOMAIN}`,
  supportWaUrl: "https://wa.me/573506674686",
  navy: "#1C3461",
  blue: "#1D4ED8",
  heading: "#0F172A",
  body: "#334155",
  muted: "#64748B",
  bg: "#F1F5F9",
  soft: "#EFF6FF",
  border: "#E2E8F0",
};

const FONT = "'Poppins','Segoe UI',Roboto,Helvetica,Arial,sans-serif";

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
 * HTML de correo: solo tablas y estilos en línea (Gmail/Outlook ignoran <style>
 * y CSS moderno), ancho máximo 560 px y botón "a prueba de balas".
 *
 * @param {{ ownerName?: string, businessName: string, email: string, slug: string }} data
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildWelcomeEmail({ ownerName, businessName, email, slug }) {
  const url = panelLoginUrl(slug);
  const bookingUrl = `https://${slug}.${MAIN_DOMAIN}`;
  const bookingLabel = `${slug}.${MAIN_DOMAIN}`;
  const name = (ownerName || businessName || "").trim();
  const greeting = name ? `¡Hola, ${name}!` : "¡Hola!";
  const subject = `Tu cuenta de ${businessName} en AgenditApp está lista`;
  const preheader = `Guarda este correo: aquí tienes el enlace de tu panel y el correo con el que entras.`;

  const text = [
    greeting,
    "",
    `La cuenta de ${businessName} en AgenditApp quedó creada.`,
    "",
    `Entra a tu panel aquí: ${url}`,
    `Inicia sesión con este correo (${email}) y la contraseña que creaste al registrarte.`,
    "",
    "Próximos pasos:",
    "1. Agrega tus servicios con su duración y precio.",
    "2. Agrega a tus profesionales y su horario.",
    `3. Comparte tu enlace de reservas con tus clientes: ${bookingUrl}`,
    "",
    "Guarda este correo: aquí siempre tendrás el enlace de tu panel.",
    "Si te registraste desde Instagram o Facebook, abre el enlace en Chrome o Safari.",
    "",
    `¿Dudas? Responde a este correo o escríbenos por WhatsApp: ${BRAND.supportWaUrl}`,
    "",
    "El equipo de AgenditApp",
  ].join("\n");

  const step = (n, title, detail) => `
              <tr>
                <td width="40" valign="top" style="padding:0 0 16px;">
                  <div style="width:28px;height:28px;line-height:28px;border-radius:14px;background:${BRAND.soft};color:${BRAND.blue};font-weight:700;font-size:14px;text-align:center;">${n}</div>
                </td>
                <td valign="top" style="padding:3px 0 16px;font-family:${FONT};font-size:15px;line-height:1.5;color:${BRAND.body};">
                  <strong style="color:${BRAND.heading};">${title}</strong><br>${detail}
                </td>
              </tr>`;

  const html = `<!doctype html>
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

        <!-- Marca -->
        <tr><td align="center" style="padding:0 0 20px;">
          <a href="${BRAND.siteUrl}" style="text-decoration:none;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td valign="middle" style="padding-right:10px;"><img src="${BRAND.logoUrl}" width="40" height="40" alt="AgenditApp" style="display:block;border:0;"></td>
              <td valign="middle" style="font-family:${FONT};font-size:22px;font-weight:700;color:${BRAND.navy};letter-spacing:-0.3px;">AgenditApp</td>
            </tr></table>
          </a>
        </td></tr>

        <!-- Tarjeta -->
        <tr><td style="background:#ffffff;border-radius:14px;border:1px solid ${BRAND.border};overflow:hidden;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="height:6px;background:${BRAND.blue};font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr><td style="padding:32px 32px 8px;font-family:${FONT};">
              <h1 style="margin:0 0 10px;font-size:24px;line-height:1.3;color:${BRAND.heading};">${escapeHtml(greeting)}</h1>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:${BRAND.body};">La cuenta de <strong style="color:${BRAND.heading};">${escapeHtml(businessName)}</strong> en AgenditApp ya está lista. Estos son tus datos para entrar a tu panel:</p>

              <!-- Datos de ingreso -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.soft};border-radius:12px;">
                <tr><td style="padding:18px 20px 6px;font-family:${FONT};">
                  <div style="font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${BRAND.muted};">Enlace de tu panel</div>
                  <div style="padding-top:4px;font-size:15px;word-break:break-all;"><a href="${escapeHtml(url)}" style="color:${BRAND.blue};text-decoration:none;font-weight:600;">${escapeHtml(url)}</a></div>
                </td></tr>
                <tr><td style="padding:12px 20px 18px;font-family:${FONT};">
                  <div style="font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${BRAND.muted};">Correo de ingreso</div>
                  <div style="padding-top:4px;font-size:15px;color:${BRAND.heading};font-weight:600;word-break:break-all;">${escapeHtml(email)}</div>
                  <div style="padding-top:4px;font-size:13px;color:${BRAND.muted};">Con la contraseña que creaste al registrarte.</div>
                </td></tr>
              </table>

              <!-- Botón -->
              <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:28px auto 8px;">
                <tr><td align="center" bgcolor="${BRAND.blue}" style="border-radius:10px;">
                  <a href="${escapeHtml(url)}" style="display:inline-block;padding:15px 34px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">Entrar a mi panel</a>
                </td></tr>
              </table>
              <p style="margin:0 0 28px;text-align:center;font-size:13px;line-height:1.5;color:${BRAND.muted};">¿Te registraste desde Instagram o Facebook? Abre el enlace en Chrome o Safari.</p>
            </td></tr>

            <tr><td style="padding:0 32px;"><div style="height:1px;background:${BRAND.border};font-size:0;line-height:0;">&nbsp;</div></td></tr>

            <!-- Próximos pasos -->
            <tr><td style="padding:24px 32px 12px;font-family:${FONT};">
              <h2 style="margin:0 0 16px;font-size:17px;color:${BRAND.heading};">Tus próximos pasos</h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${step(
                1,
                "Agrega tus servicios",
                "Con su duración y precio."
              )}${step(2, "Agrega a tus profesionales", "Y el horario en que atienden.")}${step(
                3,
                "Comparte tu enlace de reservas",
                `Tus clientes reservan solos en <a href="${escapeHtml(bookingUrl)}" style="color:${BRAND.blue};text-decoration:none;font-weight:600;">${escapeHtml(bookingLabel)}</a>`
              )}
              </table>
            </td></tr>

            <!-- Ayuda -->
            <tr><td style="padding:0 32px 32px;font-family:${FONT};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BRAND.border};border-radius:12px;">
                <tr><td style="padding:16px 20px;font-size:14px;line-height:1.6;color:${BRAND.body};">
                  <strong style="color:${BRAND.heading};">Guarda este correo.</strong> Aquí siempre tendrás el enlace de tu panel. ¿Dudas? Responde este correo o <a href="${BRAND.supportWaUrl}" style="color:${BRAND.blue};text-decoration:none;font-weight:600;">escríbenos por WhatsApp</a>.
                </td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <!-- Pie -->
        <tr><td align="center" style="padding:22px 16px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${BRAND.muted};">
          El equipo de AgenditApp · <a href="${BRAND.siteUrl}" style="color:${BRAND.muted};">agenditapp.com</a><br>
          Recibes este correo porque creaste una cuenta en AgenditApp.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
