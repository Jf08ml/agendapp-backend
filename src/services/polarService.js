// services/polarService.js
// Integración con Polar via API HTTP (sin SDK), usando productos y successUrl
import crypto from "crypto";

const POLAR_API_BASE = process.env.POLAR_API_BASE || "https://api.polar.sh";
const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN || "";

async function http(method, path, body) {
  if (!POLAR_ACCESS_TOKEN) {
    throw new Error("POLAR_ACCESS_TOKEN no está configurado");
  }
  const url = `${POLAR_API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Error Polar ${res.status}: ${text}`);
  }
  return res.json();
}

const polarService = {
  // Crea un link de checkout en Polar para un plan (producto) en USD
  createCheckoutLink: async ({ plan, organizationId, returnUrl, metadata = {} }) => {
    const productId = plan?.payment?.productId;
    if (!productId) {
      throw new Error(`No hay productId configurado en el plan ${plan.slug}`);
    }

    // Basado en el snippet del SDK: { products: [productId], successUrl }
    // La API HTTP esperada: POST /v1/checkouts
    // Enviamos ambas variantes de la clave por compatibilidad: successUrl y success_url
    const payload = {
      products: [productId],
      successUrl: returnUrl,
      success_url: returnUrl,
      // metadata si la API lo soporta; lo incluimos por si está disponible
      metadata: {
        organizationId,
        planId: String(plan._id),
        planSlug: plan.slug,
        ...metadata,
      },
    };

    const data = await http("POST", "/v1/checkouts", payload);

    return {
      checkoutUrl: data?.url,
      sessionId: data?.id,
      raw: data,
    };
  },

  // Verificar una sesión / checkout en Polar (si la API lo permite)
  getCheckout: async (sessionId) => {
    return await http("GET", `/v1/checkouts/${sessionId}`);
  },

  // Verificar firma del webhook.
  // Intenta múltiples formatos comunes:
  // 1) HMAC-SHA256 del cuerpo: hex/base64 en header
  // 2) Formato con timestamp: "t=...;v1=..." donde v1 = HMAC-SHA256(`${t}.${body}`)
  // 3) Formato Bearer: "Bearer <hex_digest>"
  // 4) Formato Svix (usado por Polar): webhook-id.timestamp.body
  verifyWebhookSignature: (signature, timestamp, webhookId, payloadStr) => {
    const secret = process.env.POLAR_WEBHOOK_SECRET;
    const allowUnsigned = String(process.env.POLAR_WEBHOOK_ALLOW_UNSIGNED || "").toLowerCase() === "true";
    const debug = String(process.env.POLAR_WEBHOOK_DEBUG || "").toLowerCase() === "true";
    
    // Debug: mostrar el secret (solo primeros caracteres por seguridad)
    if (debug) {
      console.log("[polar webhook] Secret info:", {
        hasSecret: !!secret,
        secretPrefix: secret ? secret.slice(0, 15) + "..." : "none",
        secretLength: secret ? secret.length : 0,
      });
    }
    
    // Si modo permisivo está activo, permitir cualquier webhook sin verificación
    if (allowUnsigned) {
      console.log("[polar webhook] ✓ Allowing unsigned webhook (POLAR_WEBHOOK_ALLOW_UNSIGNED=true)");
      return true;
    }
    
    if (!secret) return true; // Permitir en desarrollo si no está configurado

    try {
      if (!signature || !payloadStr) return false;

      // Polar/Svix secrets suelen venir como "whsec_<base64>".
      // En algunos casos hemos visto "polar_whs_<...>".
      // Para evitar ambigüedades (base64 vs raw), probamos múltiples derivaciones.
      const secretStr = String(secret);
      const noPrefix = secretStr.startsWith("whsec_")
        ? secretStr.slice("whsec_".length)
        : secretStr.startsWith("polar_whs_")
          ? secretStr.slice("polar_whs_".length)
          : secretStr;

      const normalizeBase64Url = (s) => {
        const replaced = s.replace(/-/g, "+").replace(/_/g, "/");
        const padLen = (4 - (replaced.length % 4)) % 4;
        return replaced + "=".repeat(padLen);
      };

      const candidateKeys = [];
      // 1) Secret tal cual (incluye prefijo si existe)
      candidateKeys.push({ kind: "raw", key: secretStr });
      // 2) Secret sin prefijo (string)
      if (noPrefix !== secretStr) candidateKeys.push({ kind: "noPrefix", key: noPrefix });
      // 3) Secret sin prefijo decodificado como base64 estándar
      try {
        const buf = Buffer.from(noPrefix, "base64");
        if (buf.length > 0) candidateKeys.push({ kind: "base64(noPrefix)", key: buf });
      } catch {}
      // 4) Secret sin prefijo decodificado como base64url
      try {
        const buf = Buffer.from(normalizeBase64Url(noPrefix), "base64");
        if (buf.length > 0) candidateKeys.push({ kind: "base64url(noPrefix)", key: buf });
      } catch {}

      const bodyBuf = Buffer.from(payloadStr, "utf8");

      // Helper para comparación segura
      const equalsSafe = (a, b) => {
        const ab = Buffer.from(a);
        const bb = Buffer.from(b);
        if (ab.length !== bb.length) return false;
        return crypto.timingSafeEqual(ab, bb);
      };

      // Polar/Svix: webhook-signature puede venir como:
      // - "v1,<base64>"
      // - "v1,<sig1> v1,<sig2>" (múltiples firmas)
      // - "Bearer <hex>" (observado en algunos entornos)
      // - digest directo
      const normalizedSignature = String(signature).trim();

      // Preparar candidatos de comparación (solo digests)
      const candidates = [];

      if (normalizedSignature.startsWith("Bearer ")) {
        candidates.push(normalizedSignature.slice("Bearer ".length).trim());
      } else {
        // Soportar múltiples firmas separadas por espacios
        const parts = normalizedSignature.split(/\s+/).filter(Boolean);
        for (const part of parts) {
          if (part.includes(",")) {
            const [ver, dig] = part.split(",", 2);
            if ((ver || "").trim() === "v1" && dig) {
              candidates.push(dig.trim());
            } else if (dig) {
              candidates.push(dig.trim());
            }
          } else {
            candidates.push(part.trim());
          }
        }
      }

      // Fallback: por si no pudimos extraer nada, usar el header completo
      if (candidates.length === 0) candidates.push(normalizedSignature);

      // Intentar con cada derivación de secret hasta que alguna coincida
      let lastComputed = null;
      for (const { kind, key } of candidateKeys) {
        // Calcular HMAC del cuerpo (sin timestamp)
        const hHex = crypto.createHmac("sha256", key).update(bodyBuf).digest("hex");
        const hB64 = crypto.createHmac("sha256", key).update(bodyBuf).digest("base64");

        // Si hay timestamp, probar formato `${timestamp}.${body}`
        let tHex = null;
        let tB64 = null;
        // Probar formato con webhook-id: `${webhook_id}.${timestamp}.${body}` (estilo Svix)
        let wtHex = null;
        let wtB64 = null;

        if (timestamp) {
          const signedPayload = `${timestamp}.${payloadStr}`;
          tHex = crypto.createHmac("sha256", key).update(signedPayload, "utf8").digest("hex");
          tB64 = crypto.createHmac("sha256", key).update(signedPayload, "utf8").digest("base64");
        }

        if (webhookId && timestamp) {
          const signedPayloadWithId = `${webhookId}.${timestamp}.${payloadStr}`;
          wtHex = crypto.createHmac("sha256", key).update(signedPayloadWithId, "utf8").digest("hex");
          wtB64 = crypto.createHmac("sha256", key).update(signedPayloadWithId, "utf8").digest("base64");
        }

        lastComputed = { kind, hHex, hB64, tHex, tB64, wtHex, wtB64 };

        if (debug) {
          console.log("[polar webhook] computed digests:", {
            keyKind: kind,
            keyIsBuffer: Buffer.isBuffer(key),
            payloadLength: payloadStr.length,
            hHex,
            hB64,
            tHex,
            tB64,
            wtHex,
            wtB64,
          });
        }

        // Comparar candidatos con cualquier digest conocido
        for (const cand of candidates) {
          const c = cand.trim();
          if (debug) {
            console.log("[polar webhook] testing candidate:", {
              candidate: c.slice(0, 70),
              candidateLength: c.length,
              keyKind: kind,
            });
          }

          // Base64 exact (case-sensitive)
          if (hB64 && equalsSafe(hB64, c)) {
            if (debug) console.log("[polar webhook] ✓ Match:", { keyKind: kind, type: "hB64" });
            return true;
          }
          if (tB64 && equalsSafe(tB64, c)) {
            if (debug) console.log("[polar webhook] ✓ Match:", { keyKind: kind, type: "tB64" });
            return true;
          }
          if (wtB64 && equalsSafe(wtB64, c)) {
            if (debug) console.log("[polar webhook] ✓ Match:", { keyKind: kind, type: "wtB64" });
            return true;
          }

          // Hex compare (case-insensitive)
          const cLower = c.toLowerCase();
          if (equalsSafe(hHex, cLower)) {
            if (debug) console.log("[polar webhook] ✓ Match:", { keyKind: kind, type: "hHex" });
            return true;
          }
          if (tHex && equalsSafe(tHex, cLower)) {
            if (debug) console.log("[polar webhook] ✓ Match:", { keyKind: kind, type: "tHex" });
            return true;
          }
          if (wtHex && equalsSafe(wtHex, cLower)) {
            if (debug) console.log("[polar webhook] ✓ Match:", { keyKind: kind, type: "wtHex" });
            return true;
          }

          if (cLower.startsWith("sha256=")) {
            const val = c.slice("sha256=".length);
            const vLower = val.toLowerCase();
            if (equalsSafe(hHex, vLower) || (tHex && equalsSafe(tHex, vLower)) || (wtHex && equalsSafe(wtHex, vLower))) {
              if (debug) console.log("[polar webhook] ✓ Match:", { keyKind: kind, type: "sha256=prefix" });
              return true;
            }
          }
        }
      }

      // Si no coincidió ninguna derivación
      const hHex = lastComputed?.hHex;
      const hB64 = lastComputed?.hB64;
      const tHex = lastComputed?.tHex;
      const tB64 = lastComputed?.tB64;
      const wtHex = lastComputed?.wtHex;
      const wtB64 = lastComputed?.wtB64;

      // Comparar candidatos con cualquier digest conocido
      for (const cand of candidates) {
        // NO convertir a minúsculas - Base64 es case-sensitive
        // Solo normalizar espacios
        const c = cand.trim();
        
        if (debug) {
          console.log("[polar webhook] testing candidate:", {
            candidate: c.slice(0, 50),
            candidateLength: c.length,
          });
        }
        
        // Comparar directamente con digests base64
        if (hB64 && equalsSafe(hB64, c)) {
          if (debug) console.log("[polar webhook] ✓ Match: hB64");
          return true;
        }
        if (tB64 && equalsSafe(tB64, c)) {
          if (debug) console.log("[polar webhook] ✓ Match: tB64 (timestamp.body)");
          return true;
        }
        if (wtB64 && equalsSafe(wtB64, c)) {
          if (debug) console.log("[polar webhook] ✓ Match: wtB64 (id.timestamp.body)");
          return true;
        }
        
        // Comparar con hex (convertir ambos a minúsculas para hex)
        const cLower = c.toLowerCase();
        if (equalsSafe(hHex, cLower)) {
          if (debug) console.log("[polar webhook] ✓ Match: hHex");
          return true;
        }
        if (tHex && equalsSafe(tHex, cLower)) {
          if (debug) console.log("[polar webhook] ✓ Match: tHex (timestamp.body)");
          return true;
        }
        if (wtHex && equalsSafe(wtHex, cLower)) {
          if (debug) console.log("[polar webhook] ✓ Match: wtHex (id.timestamp.body)");
          return true;
        }
        
        // Manejar prefijo tipo "sha256=..."
        if (cLower.startsWith("sha256=")) {
          const val = c.slice("sha256=".length);
          if (equalsSafe(hHex, val.toLowerCase()) || (tHex && equalsSafe(tHex, val.toLowerCase())) || (wtHex && equalsSafe(wtHex, val.toLowerCase()))) {
            if (debug) console.log("[polar webhook] ✓ Match: sha256= prefix");
            return true;
          }
        }
      }

      console.warn("[polar webhook] signature mismatch details", {
        secretProvided: !!secret,
        header: signature,
        candidatesCount: Array.isArray(candidates) ? candidates.length : 0,
        keyKindsTried: candidateKeys.map((k) => k.kind),
        webhookId: webhookId,
        bodyHex: hHex,
        bodyB64: hB64,
        ts: timestamp,
        tHex: tHex,
        tB64: tB64,
        wtHex: wtHex,
        wtB64: wtB64,
        payloadStrPreview: payloadStr.slice(0, 100),
      });
      return false;
    } catch (e) {
      console.warn("verifyWebhookSignature error:", e?.message || e);
      return false;
    }
  },
};

export default polarService;
