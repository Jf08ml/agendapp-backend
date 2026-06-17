/**
 * MercadoPagoCollectionProvider.js
 *
 * Proveedor de cobros cliente→org sobre Checkout Pro de Mercado Pago, operando
 * EN NOMBRE DEL VENDEDOR (el access_token del comercio obtenido por OAuth en la
 * Fase 1a). El dinero va directo a su cuenta; la plataforma solo cobra
 * `marketplace_fee` (v1 = 0).
 *
 * - createCheckout: crea una preference y devuelve el init_point (checkoutUrl).
 * - getPayment:     consulta un pago por id (para confirmar status en el webhook).
 * - verifySignature: valida el header x-signature del webhook (HMAC-SHA256).
 */

import axios from "axios";
import crypto from "crypto";

const MP_API = "https://api.mercadopago.com";

/**
 * Crea una preference de Checkout Pro a nombre del vendedor.
 *
 * @param {Object} p
 * @param {number} p.amount             monto del depósito
 * @param {string} p.currency          ISO 4217 (COP, MXN, ...)
 * @param {string} p.externalReference id propio para hacer match en el webhook
 * @param {string} p.sellerToken       access_token del VENDEDOR (org.mpCollect)
 * @param {number} [p.marketplaceFee]  comisión de plataforma (v1 = 0)
 * @param {Object} p.backUrls          { success, failure, pending }
 * @param {string} [p.notificationUrl] webhook de pagos
 * @param {string} [p.title]           descripción del item
 * @param {string} [p.expirationDate]  ISO; expiración del checkout
 * @returns {Promise<{ id, checkoutUrl, raw }>}
 */
export async function createCheckout({
  amount,
  currency,
  externalReference,
  sellerToken,
  marketplaceFee = 0,
  backUrls,
  notificationUrl,
  title = "Depósito de reserva",
  expirationDate = null,
}) {
  if (!sellerToken) throw new Error("Falta el access_token del vendedor (org no conectada a MP).");

  // MP solo acepta auto_return si back_urls.success es una URL HTTPS válida
  // (rechaza http/localhost con "back_url.success must be defined"). En dev
  // (localhost) back_urls llega undefined y se omite todo.
  const successIsHttps = /^https:\/\//i.test(backUrls?.success || "");

  const body = {
    items: [
      {
        title,
        quantity: 1,
        unit_price: Number(amount),
        currency_id: String(currency || "COP").toUpperCase(),
      },
    ],
    external_reference: String(externalReference),
    // marketplace_fee solo si es > 0: enviarlo (incluso en 0) fuerza el modo
    // split/marketplace, que requiere que la app tenga ese permiso habilitado;
    // si no, MP rechaza el checkout con un error genérico. Con OAuth el dinero
    // ya va directo al vendedor sin necesidad de este campo.
    ...(Number(marketplaceFee) > 0 ? { marketplace_fee: Number(marketplaceFee) } : {}),
    // back_urls solo si son públicas (MP descarta localhost → checkout roto).
    ...(backUrls ? { back_urls: backUrls } : {}),
    ...(successIsHttps ? { auto_return: "approved" } : {}),
    ...(notificationUrl ? { notification_url: notificationUrl } : {}),
    ...(expirationDate
      ? { expires: true, expiration_date_to: expirationDate }
      : {}),
  };

  const { data } = await axios.post(`${MP_API}/checkout/preferences`, body, {
    headers: {
      Authorization: `Bearer ${sellerToken}`,
      "Content-Type": "application/json",
    },
  });

  // Usar SIEMPRE init_point. El dominio sandbox.mercadopago.com está deprecado
  // (no resuelve); con un token de TEST USER, init_point ya opera en modo prueba
  // automáticamente. Para que el pago de prueba funcione, la cuenta de prueba
  // COMPRADORA debe tener una aplicación registrada en su propio panel de
  // developer (gotcha de MP), si no MP da "una de las partes es de prueba".
  return { id: data.id, checkoutUrl: data.init_point, raw: data };
}

/**
 * Consulta un pago por id usando el token del vendedor. Se usa en el webhook
 * (Fase 1d) para confirmar `status: "approved"` antes de aprobar la reserva.
 */
export async function getPayment(paymentId, sellerToken) {
  const { data } = await axios.get(`${MP_API}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${sellerToken}` },
  });
  return data;
}

/**
 * Valida la firma del webhook de MP.
 * Manifest: `id:[data.id];request-id:[x-request-id];ts:[ts];`
 * v1 = HMAC_SHA256(manifest, signatureSecret) en hex.
 *
 * @param {Object} p
 * @param {string} p.xSignature  header x-signature ("ts=...,v1=...")
 * @param {string} p.xRequestId  header x-request-id
 * @param {string} p.dataId      data.id de la query/body de la notificación
 * @param {string} p.secret      signature secret del dashboard de MP
 * @returns {boolean}
 */
export function verifySignature({ xSignature, xRequestId, dataId, secret }) {
  if (!xSignature || !secret) return false;

  const parts = Object.fromEntries(
    String(xSignature)
      .split(",")
      .map((kv) => kv.split("=").map((s) => s.trim()))
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  // MP indica usar data.id en minúsculas si es alfanumérico.
  const idPart = dataId ? String(dataId).toLowerCase() : "";
  const manifest = `id:${idPart};request-id:${xRequestId || ""};ts:${ts};`;
  const computed = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(v1));
  } catch {
    return false;
  }
}

export default { createCheckout, getPayment, verifySignature };
