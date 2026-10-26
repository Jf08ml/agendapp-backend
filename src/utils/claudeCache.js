// Punto de caché móvil en el último mensaje: cada ronda de tools reenvía toda la
// conversación (incluido el catálogo de get_services), y sin esto se cobraba
// completa en cada ronda — sesiones de 5 mensajes llegaban a ~100k tokens de
// entrada (oct-2026). Con él, la siguiente ronda lee ese prefijo de la caché.
export const withMessageCacheBreakpoint = (messages) => {
  if (!messages.length) return messages;
  const last = messages[messages.length - 1];
  const blocks = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
  if (!Array.isArray(blocks) || !blocks.length) return messages;
  const cached = [
    ...blocks.slice(0, -1),
    { ...blocks[blocks.length - 1], cache_control: { type: "ephemeral" } },
  ];
  return [...messages.slice(0, -1), { ...last, content: cached }];
};
