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
  verifyWebhookSignature: (signature, timestamp, webhookId, payloadStr) => {
    const secret = process.env.POLAR_WEBHOOK_SECRET;
    const allowUnsigned = String(process.env.POLAR_WEBHOOK_ALLOW_UNSIGNED || "").toLowerCase() === "true";
    
    // Si modo permisivo está activo, permitir cualquier webhook sin verificación
    if (allowUnsigned) return true;
    
    if (!secret) return true; // Permitir en desarrollo si no está configurado

    try {
      if (!signature || !payloadStr) return false;

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
      // Firma con formato "v1,<digest>" donde digest parece base64 de HMAC-SHA256(`${timestamp}.${body}`)
      // También soportamos otros formatos genéricos como antes.
      let observedVersion = null;
      let observedDigest = null;
      if (signature.includes(",")) {
        const [ver, dig] = signature.split(",");
        observedVersion = ver.trim();
        observedDigest = dig.trim();
      }

      // Preparar candidatos de comparación
      const candidates = [];
      if (observedDigest) candidates.push(observedDigest);
      // También considerar el header completo por si es un digest directo
      candidates.push(signature.trim());

      // Calcular HMAC del cuerpo
      const hHex = crypto.createHmac("sha256", secret).update(bodyBuf).digest("hex");
      const hB64 = crypto.createHmac("sha256", secret).update(bodyBuf).digest("base64");

      // Si hay timestamp, probar formato `${timestamp}.${body}`
      let tHex = null;
      let tB64 = null;
      // Probar formato con webhook-id: `${webhook_id}.${timestamp}.${body}` (estilo Svix)
      let wtHex = null;
      let wtB64 = null;
      
      if (timestamp) {
        const signedPayload = `${timestamp}.${payloadStr}`;
        tHex = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
        tB64 = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("base64");
        console.log("[polar webhook] computed signedPayload (ts.body):", {
          ts: timestamp,
          payloadLength: payloadStr.length,
          signedPayloadPreview: signedPayload.slice(0, 100),
          tHex: tHex,
          tB64: tB64,
        });
      }

      if (webhookId && timestamp) {
        const signedPayloadWithId = `${webhookId}.${timestamp}.${payloadStr}`;
        wtHex = crypto.createHmac("sha256", secret).update(signedPayloadWithId, "utf8").digest("hex");
        wtB64 = crypto.createHmac("sha256", secret).update(signedPayloadWithId, "utf8").digest("base64");
        console.log("[polar webhook] computed signedPayload (id.ts.body):", {
          webhookId: webhookId,
          ts: timestamp,
          payloadLength: payloadStr.length,
          signedPayloadPreview: signedPayloadWithId.slice(0, 100),
          wtHex: wtHex,
          wtB64: wtB64,
        });
      }

      // Comparar candidatos con cualquier digest conocido
      for (const cand of candidates) {
        // NO convertir a minúsculas - Base64 es case-sensitive
        // Solo normalizar espacios
        const c = cand.trim();
        
        // Comparar directamente con digests base64
        if (hB64 && equalsSafe(hB64, c)) return true;
        if (tB64 && equalsSafe(tB64, c)) return true;
        if (wtB64 && equalsSafe(wtB64, c)) return true;
        
        // Comparar con hex (convertir ambos a minúsculas para hex)
        const cLower = c.toLowerCase();
        if (equalsSafe(hHex, cLower)) return true;
        if (tHex && equalsSafe(tHex, cLower)) return true;
        if (wtHex && equalsSafe(wtHex, cLower)) return true;
        
        // Manejar prefijo tipo "sha256=..."
        if (cLower.startsWith("sha256=")) {
          const val = c.slice("sha256=".length);
          if (equalsSafe(hHex, val.toLowerCase()) || (tHex && equalsSafe(tHex, val.toLowerCase())) || (wtHex && equalsSafe(wtHex, val.toLowerCase()))) return true;
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
