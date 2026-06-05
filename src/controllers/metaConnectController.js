import {
  requestVerification,
  verifyCode,
  activateCoexistence,
  activateCloudOnly,
  connectOrgEmbedded,
  getMetaStatus,
  disconnectOrg,
} from "../services/metaConnectService.js";
import sendResponse from "../utils/sendResponse.js";

/** POST /:id/meta-request-verification */
export async function handleRequestVerification(req, res) {
  try {
    const { id } = req.params;
    const { cc, phone, verifiedName, method } = req.body;
    if (!cc || !phone) return sendResponse(res, 400, null, "cc y phone son requeridos");
    const result = await requestVerification(id, cc, phone, verifiedName, method);
    sendResponse(res, 200, result, "Código de verificación enviado");
  } catch (err) {
    console.error("[metaConnect] requestVerification error:", err.response?.data || err.message);
    const metaErr = err.response?.data?.error;
    const userMsg = metaErr?.error_user_msg || metaErr?.message || err.message;
    const status = metaErr?.code === 136024 ? 429 : 500;
    sendResponse(res, status, null, userMsg);
  }
}

/** POST /:id/meta-verify-code */
export async function handleVerifyCode(req, res) {
  try {
    const { id } = req.params;
    const { code } = req.body;
    if (!code) return sendResponse(res, 400, null, "code es requerido");
    const result = await verifyCode(id, code);
    sendResponse(res, 200, result, "Número verificado correctamente");
  } catch (err) {
    console.error("[metaConnect] verifyCode error:", err.response?.data || err.message);
    const metaMsg = err.response?.data?.error?.message;
    sendResponse(res, 400, null, metaMsg || err.message);
  }
}

/** POST /:id/meta-activate */
export async function handleActivate(req, res) {
  try {
    const { id } = req.params;
    const { mode, pin } = req.body;
    if (!mode || !["coexistence", "cloud_only"].includes(mode)) {
      return sendResponse(res, 400, null, "mode debe ser 'coexistence' o 'cloud_only'");
    }

    let result;
    if (mode === "coexistence") {
      result = await activateCoexistence(id);
    } else {
      if (!pin) return sendResponse(res, 400, null, "pin es requerido para modo cloud_only");
      result = await activateCloudOnly(id, pin);
    }

    sendResponse(res, 200, result, "Conexión WhatsApp Business activada");
  } catch (err) {
    console.error("[metaConnect] activate error:", err.response?.data || err.message);
    sendResponse(res, 500, null, err.response?.data?.error?.message || err.message);
  }
}

/** POST /:id/meta-embedded-connect — Embedded Signup: intercambia code, guarda WABA+phone (sin activar) */
export async function handleEmbeddedConnect(req, res) {
  try {
    const { id } = req.params;
    const { code, redirectUri, wabaId, phoneNumberId } = req.body;
    if (!code) return sendResponse(res, 400, null, "code es requerido");
    const result = await connectOrgEmbedded(id, code, redirectUri, wabaId, phoneNumberId);
    sendResponse(res, 200, result, "Cuenta conectada. Elige el modo de activación.");
  } catch (err) {
    console.error("[metaConnect] embeddedConnect error:", err.response?.data || err.message);
    sendResponse(res, 500, null, err.response?.data?.error?.message || err.message);
  }
}

/** DELETE /:id/meta-disconnect */
export async function handleMetaDisconnect(req, res) {
  try {
    const { id } = req.params;
    await disconnectOrg(id);
    sendResponse(res, 200, null, "Conexión Meta desvinculada");
  } catch (err) {
    console.error("[metaConnect] disconnect error:", err.message);
    sendResponse(res, 500, null, err.message);
  }
}

/** GET /:id/meta-status */
export async function handleMetaStatus(req, res) {
  try {
    const { id } = req.params;
    const status = await getMetaStatus(id);
    sendResponse(res, 200, status);
  } catch (err) {
    sendResponse(res, 500, null, err.message);
  }
}
