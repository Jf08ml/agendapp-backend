// Enlaces de acceso al panel de un negocio. Viven aquí para que el correo y el
// WhatsApp de bienvenida (y más adelante el acceso sin contraseña) apunten
// siempre al mismo sitio.
//
// Ojo: la raíz del subdominio ({slug}.agenditapp.com) es la página pública de
// reservas de los clientes, no el panel; por eso el enlace es /login-admin.

export const MAIN_DOMAIN = "agenditapp.com";

/** https://{slug}.agenditapp.com/login-admin */
export function panelLoginUrl(slug) {
  return `https://${slug}.${MAIN_DOMAIN}/login-admin`;
}

/**
 * Componentes de la plantilla de plataforma `cuenta_creada` (categoría
 * Utilidad, idioma "es"):
 *   body:   {{1}} nombre del dueño · {{2}} negocio · {{3}} correo de la cuenta
 *   botón 0 (URL dinámica): https://app.agenditapp.com/ingresar/{{1}} → slug
 * Meta rechaza parámetros con saltos de línea/tabs: se colapsan a espacios.
 */
export function cuentaCreadaComponents({ ownerName, businessName, email, slug }) {
  const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim() || "—";
  return [
    {
      type: "body",
      parameters: [ownerName, businessName, email].map((t) => ({ type: "text", text: clean(t) })),
    },
    {
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: clean(slug) }],
    },
  ];
}
