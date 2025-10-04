import jwt from "jsonwebtoken";

const WS_JWT_SECRET = process.env.WS_JWT_SECRET;

export function issueWsToken({ userId, orgId, clientId, scope }) {
  // scope es opcional; por ahora solo lectura de eventos de WS
  const payload = {
    sub: userId,
    orgId,
    clientId,
    scope: scope || ["ws:status", "ws:qr", "ws:bulk"],
  };
  const token = jwt.sign(payload, WS_JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: 60, // 60s es suficiente para el handshake
    issuer: "agenda-backend", // debe coincidir con la verificación en wa-backend
  });
  return { token, expiresIn: 60 };
}
