import { createHmac, timingSafeEqual } from "crypto";

/**
 * Llamadas de AgenditApp Oficina IA al backend (contrato en
 * agenditapp-oficina/docs/ACTIVACION.md). Firmadas con HMAC-SHA256 y el
 * secreto OFICINA_API_SECRET, que es distinto de OFICINA_EVENTS_SECRET:
 *
 *   X-Oficina-Signature: t=<segundos unix>,v1=<hex HMAC de "<t>.<MÉTODO>.<ruta?consulta>.<cuerpo exacto>">
 *
 * La firma incluye el método y la ruta, así que no sirve para otra llamada, y
 * vale 5 minutos. Sin OFICINA_API_SECRET las rutas responden 503.
 */

const TOLERANCE_SECONDS = 300;

function parseHeader(header) {
  const parts = {};
  for (const piece of String(header || "").split(",")) {
    const i = piece.indexOf("=");
    if (i > 0) parts[piece.slice(0, i).trim()] = piece.slice(i + 1).trim();
  }
  return parts;
}

export function oficinaSignature(req, res, next) {
  const secret = process.env.OFICINA_API_SECRET;
  if (!secret || secret.length < 32) {
    return res.status(503).json({ error: { code: "disabled", message: "La API de la Oficina no está configurada" } });
  }
  const invalid = () => res.status(401).json({ error: { code: "invalid_signature", message: "Firma ausente, inválida o caducada" } });

  const { t, v1 } = parseHeader(req.headers["x-oficina-signature"]);
  const timestamp = Number(t);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > TOLERANCE_SECONDS) return invalid();
  if (typeof v1 !== "string" || !/^[a-f0-9]{64}$/.test(v1)) return invalid();

  // El cuerpo crudo lo guarda express.json (app.js); en un GET no hay cuerpo.
  const body = req.method === "GET" ? "" : req.rawBody || "";
  const expected = createHmac("sha256", secret).update(`${timestamp}.${req.method}.${req.originalUrl}.${body}`).digest();
  const given = Buffer.from(v1, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return invalid();
  return next();
}
