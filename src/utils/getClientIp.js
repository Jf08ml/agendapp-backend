/**
 * Extrae la IP real del request. En el VPS, Caddy descarta el X-Forwarded-For
 * que manda el cliente y pone la IP real, así que el primer valor es fiable.
 */
export default function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}
