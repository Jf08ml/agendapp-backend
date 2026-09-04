/**
 * Extrae la IP real del request, considerando proxies/Vercel.
 */
export default function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}
