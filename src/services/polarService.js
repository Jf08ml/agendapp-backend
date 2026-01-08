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

      // El secret de Polar tiene formato "whsec_..." o "polar_whs_..."
      // La parte después del prefijo es base64-encoded
      let actualSecret = secret;
      let secretBuffer = null;
      
      if (secret.startsWith("whsec_")) {
        const base64Part = secret.slice("whsec_".length);
        secretBuffer = Buffer.from(base64Part, "base64");
      } else if (secret.startsWith("polar_whs_")) {
        const base64Part = secret.slice("polar_whs_".length);
        secretBuffer = Buffer.from(base64Part, "base64");
      } else {
        // Si no tiene prefijo, intentar usar como está y también como base64
        actualSecret = secret;
        try {
          secretBuffer = Buffer.from(secret, "base64");
        } catch (e) {
          secretBuffer = null;
        }
      }

      const bodyBuf = Buffer.from(payloadStr, "utf8");

      // Helper para comparación segura
      const equalsSafe = (a, b) => {
        const ab = Buffer.from(a);
        const bb = Buffer.from(b);
        if (ab.length !== bb.length) return false;
        return crypto.timingSafeEqual(ab, bb);
      };
      const debug = String(process.env.POLAR_WEBHOOK_DEBUG || "").toLowerCase() === "true";

      // Polar (observado): headers "webhook-signature" y "webhook-timestamp"
      // Formatos soportados:
      // 1) "v1,<digest>" - formato Svix
      // 2) "Bearer <hex_digest>" - formato Bearer token
      // 3) digest directo (hex o base64)
      let observedVersion = null;
      let observedDigest = null;
      
      // Normalizar signature eliminando espacios extra
      const normalizedSignature = signature.trim();
      
      // Detectar formato Bearer
      if (normalizedSignature.startsWith("Bearer ")) {
        observedDigest = normalizedSignature.slice("Bearer ".length).trim();
      } 
      // Detectar formato "v1,<digest>"
      else if (normalizedSignature.includes(",")) {
        const [ver, dig] = normalizedSignature.split(",");
        observedVersion = ver.trim();
        observedDigest = dig.trim();
      }
      // Si no es ninguno, usar el signature completo como digest
      else {
        observedDigest = normalizedSignature;
      }

      // Preparar candidatos de comparación
      const candidates = [];
      if (observedDigest) candidates.push(observedDigest);
      // También considerar el header completo por si acaso
      candidates.push(normalizedSignature);

      // Calcular HMACs con el secret decodificado (Buffer)
      const secretToUse = secretBuffer || actualSecret;
      
      // Calcular HMAC del cuerpo (sin timestamp)
      const hHex = crypto.createHmac("sha256", secretToUse).update(bodyBuf).digest("hex");
      const hB64 = crypto.createHmac("sha256", secretToUse).update(bodyBuf).digest("base64");

      if (debug) {
        console.log("[polar webhook] computed HMAC (body only):", {
          secretFormat: secret.startsWith("polar_whs_") ? "polar_whs_" : secret.startsWith("whsec_") ? "whsec_" : "raw",
          secretIsBuffer: Buffer.isBuffer(secretToUse),
          payloadLength: payloadStr.length,
          hHex: hHex,
          hB64: hB64,
        });
      }

      // Si hay timestamp, probar formato `${timestamp}.${body}`
      let tHex = null;
      let tB64 = null;
      // Probar formato con webhook-id: `${webhook_id}.${timestamp}.${body}` (estilo Svix)
      let wtHex = null;
      let wtB64 = null;
      
      if (timestamp) {
        const signedPayload = `${timestamp}.${payloadStr}`;
        tHex = crypto.createHmac("sha256", secretToUse).update(signedPayload, "utf8").digest("hex");
        tB64 = crypto.createHmac("sha256", secretToUse).update(signedPayload, "utf8").digest("base64");
        if (debug) {
          console.log("[polar webhook] computed signedPayload (ts.body):", {
            ts: timestamp,
            payloadLength: payloadStr.length,
            signedPayloadPreview: signedPayload.slice(0, 100),
            tHex: tHex,
            tB64: tB64,
          });
        }
      }

      if (webhookId && timestamp) {
        const signedPayloadWithId = `${webhookId}.${timestamp}.${payloadStr}`;
        wtHex = crypto.createHmac("sha256", secretToUse).update(signedPayloadWithId, "utf8").digest("hex");
        wtB64 = crypto.createHmac("sha256", secretToUse).update(signedPayloadWithId, "utf8").digest("base64");
        if (debug) {
          console.log("[polar webhook] computed signedPayload (id.ts.body):", {
            webhookId: webhookId,
            ts: timestamp,
            payloadLength: payloadStr.length,
            signedPayloadPreview: signedPayloadWithId.slice(0, 100),
            wtHex: wtHex,
            wtB64: wtB64,
          });
        }
      }

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
        version: observedVersion,
        receivedDigest: observedDigest,
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
