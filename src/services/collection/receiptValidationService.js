/**
 * receiptValidationService.js
 *
 * Validador semiautomático de comprobantes de pago con IA (visión).
 *
 * Flujo: el cliente sube la foto/captura de la transferencia → un modelo Claude
 * con visión extrae monto, fecha, referencia, cuenta destino, banco y remitente
 * → se compara contra lo esperado del `Order` y las cuentas de la organización.
 *
 * El servicio NO toca la base de datos: solo (1) extrae datos del comprobante y
 * (2) decide si se puede AUTO-APROBAR. El chequeo anti-duplicado contra la BD y
 * el cumplimiento (fulfillOrder) los hace el controlador.
 */

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Visión + barato; ya en uso en los chatbots. Si la precisión flaquea en
// comprobantes borrosos, subir a un modelo Sonnet solo para este caso.
const MODEL = "claude-haiku-4-5-20251001";

// Monedas sin decimales: el monto debe coincidir exacto.
const ZERO_DECIMAL_CURRENCIES = new Set(["COP", "CLP", "PYG", "JPY", "KRW"]);
// Tolerancia relativa para monedas con decimales (redondeos del banco).
const AMOUNT_TOLERANCE_PCT = 0.01;
// Confianza mínima de la IA para auto-aprobar.
const MIN_CONFIDENCE = 0.8;

// Herramienta de extracción: forzamos tool_use para obtener salida estructurada.
const EXTRACT_TOOL = {
  name: "registrar_comprobante",
  description:
    "Registra los datos extraídos de un comprobante de pago / transferencia bancaria.",
  input_schema: {
    type: "object",
    properties: {
      isReceipt: {
        type: "boolean",
        description: "true si la imagen es realmente un comprobante de pago/transferencia.",
      },
      amount: {
        type: "number",
        description: "Monto pagado (solo el número, sin símbolo de moneda ni separadores de miles).",
      },
      currency: { type: "string", description: "Moneda detectada (ISO, ej: COP, MXN). Vacío si no aparece." },
      date: { type: "string", description: "Fecha y hora del comprobante tal como aparece." },
      reference: {
        type: "string",
        description: "Número de transacción / referencia / comprobante / autorización. El identificador único del pago.",
      },
      destinationAccount: {
        type: "string",
        description: "Cuenta, número de teléfono o destinatario que RECIBE el dinero.",
      },
      bank: { type: "string", description: "Banco o billetera (Nequi, Bancolombia, etc.)." },
      senderName: { type: "string", description: "Nombre de quien envía el dinero, si aparece." },
      confidence: {
        type: "number",
        description: "Qué tan legible y confiable es la extracción, de 0 a 1.",
      },
      notes: {
        type: "string",
        description: "Observaciones: si la imagen está borrosa, recortada, parece editada, o algo no cuadra.",
      },
    },
    required: ["isReceipt", "confidence"],
  },
};

/**
 * Llama a Claude con visión para extraer los datos del comprobante.
 *
 * @param {Object} p
 * @param {string} p.imageBase64  imagen en base64 (sin el prefijo data:)
 * @param {string} p.mimeType     image/jpeg | image/png | image/webp
 * @param {Object} p.expected     { amount, currency } esperado (contexto para la IA)
 * @returns {Promise<Object>} datos extraídos + confidence + notes
 */
export async function extractReceiptData({ imageBase64, mimeType, expected = {} }) {
  const contextLine = expected.amount
    ? `Se espera un pago de aproximadamente ${expected.amount} ${expected.currency || ""}.`
    : "";

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "registrar_comprobante" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mimeType, data: imageBase64 },
          },
          {
            type: "text",
            text:
              `Analiza este comprobante de pago y extrae sus datos con la herramienta. ${contextLine}\n` +
              `Para el monto, devuelve solo el número (ej: 25000, no "$25.000"). ` +
              `Si la imagen NO es un comprobante de pago, marca isReceipt=false. ` +
              `Sé honesto con la confianza: baja si está borroso, recortado o sospechoso.`,
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  const data = toolUse?.input || {};

  return {
    isReceipt: data.isReceipt !== false,
    amount: typeof data.amount === "number" ? data.amount : null,
    currency: (data.currency || "").toUpperCase() || null,
    date: data.date || null,
    reference: data.reference ? String(data.reference).trim() : null,
    destinationAccount: data.destinationAccount || null,
    bank: data.bank || null,
    senderName: data.senderName || null,
    confidence: typeof data.confidence === "number" ? data.confidence : 0,
    notes: data.notes || null,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
  };
}

/** Deja solo dígitos. */
function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

/** Normaliza texto: sin acentos, minúsculas, sin @, espacios ni signos. */
function normText(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * ¿Coincide la cuenta destino extraída con alguna cuenta configurada de la org?
 * Soporta: cuentas/teléfonos numéricos (match por sufijo), llaves alfanuméricas
 * (Bre-B, @handles, emails — substring), y el nombre del titular (substring).
 */
function destinationMatches(extractedAccount, paymentMethods = []) {
  const extDigits = digitsOnly(extractedAccount);
  const extNorm = normText(extractedAccount);
  if (!extNorm) return { matched: false, hadAccounts: false };

  // Identificadores esperados: numéricos (cuenta/teléfono) y de texto (llave/nombre).
  const idents = []; // { kind: "digit" | "text", value }
  for (const pm of paymentMethods) {
    for (const field of [pm.accountNumber, pm.phoneNumber]) {
      if (!field) continue;
      if (/[a-z]/i.test(field)) {
        const t = normText(field); // llave alfanumérica / email / @handle
        if (t.length >= 3) idents.push({ kind: "text", value: t });
      } else {
        const d = digitsOnly(field);
        if (d.length >= 4) idents.push({ kind: "digit", value: d });
      }
    }
    // El nombre del titular en el destino es una señal fuerte (a quién se le pagó).
    if (pm.accountName) {
      const t = normText(pm.accountName);
      if (t.length >= 4) idents.push({ kind: "text", value: t });
    }
  }
  if (idents.length === 0) return { matched: false, hadAccounts: false };

  const matched = idents.some((id) => {
    if (id.kind === "digit") {
      if (!extDigits) return false;
      const len = Math.min(6, id.value.length, extDigits.length);
      return id.value.slice(-len) === extDigits.slice(-len);
    }
    // Texto: substring en cualquier dirección (tolera "Nombre @llave").
    return extNorm.includes(id.value) || id.value.includes(extNorm);
  });
  return { matched, hadAccounts: true };
}

/** ¿El monto extraído coincide con el esperado (con tolerancia por moneda)? */
function amountMatches(extractedAmount, expectedAmount, currency) {
  if (typeof extractedAmount !== "number" || !expectedAmount) return false;
  const cc = String(currency || "").toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(cc)) {
    return Math.round(extractedAmount) === Math.round(expectedAmount);
  }
  const tol = expectedAmount * AMOUNT_TOLERANCE_PCT;
  return Math.abs(extractedAmount - expectedAmount) <= tol;
}

/**
 * Decide el veredicto final combinando la extracción de la IA con las reglas de
 * negocio. NO consulta la BD: recibe `isDuplicateReference` ya calculado.
 *
 * @param {Object} p
 * @param {Object} p.extracted   resultado de extractReceiptData
 * @param {number} p.expectedAmount
 * @param {string} p.currency
 * @param {Array}  p.paymentMethods  org.paymentMethods[]
 * @param {boolean} p.isDuplicateReference  ¿la referencia ya se usó en un pago confirmado?
 * @returns {Object} { autoApprove, verdict, reviewStatus, reasons[] }
 */
export function evaluateReceipt({
  extracted,
  expectedAmount,
  currency,
  paymentMethods = [],
  isDuplicateReference = false,
}) {
  const reasons = [];

  if (!extracted.isReceipt) {
    return {
      autoApprove: false,
      verdict: "unreadable",
      reviewStatus: "pending_review",
      reasons: ["La imagen no parece un comprobante de pago."],
    };
  }

  if (isDuplicateReference) {
    return {
      autoApprove: false,
      verdict: "mismatch",
      reviewStatus: "pending_review",
      reasons: ["La referencia del comprobante ya fue usada en otro pago."],
    };
  }

  const okAmount = amountMatches(extracted.amount, expectedAmount, currency);
  if (!okAmount) reasons.push("El monto no coincide con el esperado.");

  const dest = destinationMatches(extracted.destinationAccount, paymentMethods);
  // Si la org no tiene cuentas configuradas, no podemos validar destino → no bloquea solo, pero no auto-aprueba.
  if (dest.hadAccounts && !dest.matched) reasons.push("La cuenta destino no coincide con las del negocio.");

  const okConfidence = extracted.confidence >= MIN_CONFIDENCE;
  if (!okConfidence) reasons.push("La IA no tiene confianza suficiente (imagen poco legible).");

  const hasReference = !!extracted.reference;
  if (!hasReference) reasons.push("No se detectó número de referencia.");

  const autoApprove =
    okAmount && okConfidence && hasReference && dest.hadAccounts && dest.matched;

  return {
    autoApprove,
    verdict: autoApprove ? "match" : reasons.length ? "mismatch" : "match",
    reviewStatus: autoApprove ? "auto_approved" : "pending_review",
    reasons,
  };
}

export default { extractReceiptData, evaluateReceipt };
