// Copia exacta aprobada en Meta Business Manager para las plantillas del número de
// plataforma (usadas por retargetingService.js vía sendPlatformTemplate). Se usa
// solo para reconstruir en el inbox de superadmin el texto tal como lo ve el
// cliente — el envío real lo resuelve Meta con la plantilla ya aprobada, esto no
// se manda a la API. Si se edita el body en Meta Business Manager, actualizar aquí.
export const PLATFORM_TEMPLATE_BODIES = {
  activa_tu_cuenta:
    "¡Hola {{1}}! 👋 Vimos que creaste la cuenta de *{{2}}* en AgenditApp pero aún no terminaste de configurarla. Faltan solo un par de minutos para tener tu agenda lista y empezar a recibir reservas. 🗓️\n\nContinúa aquí: {{3}}\n\nSi tuviste algún problema o tienes dudas, escríbenos al +57 350 667 4686 y con gusto te ayudamos.",
  agenda_tu_primera_cita:
    "¡Hola {{1}}! 😊 Ya configuraste *{{2}}* en AgenditApp, pero todavía no has creado tu primera cita. Anímate a probarlo, así ves lo fácil que es gestionar tu agenda. 🗓️\n\nCrea tu primera cita aquí: {{3}}\n\n¿Necesitas ayuda? Escríbenos al +57 350 667 4686 y te acompañamos en el proceso.",
  conecta_tu_whatsapp:
    "¡Hola {{1}}! 📱 *{{2}}* ya está funcionando en AgenditApp, pero aún no conectas tu WhatsApp. Al conectarlo, tus clientes reciben recordatorios y confirmaciones automáticas: menos inasistencias y menos mensajes manuales para ti.\n\nConéctalo aquí: {{3}}\n\nSi tienes dudas sobre cómo hacerlo, escríbenos al +57 350 667 4686 y te guiamos paso a paso.",
  trial_por_vencer:
    "¡Hola {{1}}! ⏳ Tu prueba gratuita de *{{2}}* en AgenditApp vence en *{{3}} días*. No pierdas el acceso a tu agenda, recordatorios de WhatsApp y reportes.\n\nElige tu plan aquí: {{4}}\n\nSi tienes preguntas sobre precios o necesitas más tiempo, escríbenos al +57 350 667 4686.",
};

/**
 * Reconstruye el texto tal como lo recibió el cliente, sustituyendo {{n}} por el
 * parámetro correspondiente (mismo colapso de espacios que sendPlatformTemplate
 * aplica antes de enviarlo a Meta). Devuelve null si la plantilla no está en el
 * catálogo, para que el caller pueda caer de vuelta a un preview genérico.
 * @param {string} templateName
 * @param {Array<string|number>} params - en el orden {{1}}..{{n}}
 */
export function renderPlatformTemplate(templateName, params) {
  const body = PLATFORM_TEMPLATE_BODIES[templateName];
  if (!body) return null;

  return body.replace(/\{\{(\d+)\}\}/g, (_, index) => {
    const value = params[Number(index) - 1];
    return value === undefined || value === null ? "" : String(value).replace(/\s+/g, " ").trim();
  });
}
