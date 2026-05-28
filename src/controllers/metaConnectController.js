import { connectOrg, disconnectOrg, getMetaStatus, registerPhone } from "../services/metaConnectService.js";
import sendResponse from "../utils/sendResponse.js";

export async function handleMetaConnect(req, res) {
  try {
    const { id } = req.params;
    const { code, redirectUri, wabaId, phoneNumberId } = req.body;
    if (!code) return sendResponse(res, 400, null, "code es requerido");
    const result = await connectOrg(id, code, redirectUri, wabaId, phoneNumberId);
    sendResponse(res, 200, result, "Conexión Meta establecida correctamente");
  } catch (err) {
    console.error("[metaConnect] Error conectando:", err.message, err.response?.data);
    sendResponse(res, 500, null, err.response?.data?.error?.message || err.message);
  }
}

export async function handleMetaDisconnect(req, res) {
  try {
    const { id } = req.params;
    await disconnectOrg(id);
    sendResponse(res, 200, null, "Conexión Meta desvinculada");
  } catch (err) {
    console.error("[metaConnect] Error desconectando:", err.message);
    sendResponse(res, 500, null, err.message);
  }
}

export async function handleRegisterPhone(req, res) {
  try {
    const { id } = req.params;
    const result = await registerPhone(id);
    sendResponse(res, 200, result, "Número registrado correctamente en la Cloud API");
  } catch (err) {
    console.error("[metaConnect] Error registrando número:", err.message, err.response?.data);
    sendResponse(res, 500, null, err.response?.data?.error?.message || err.message);
  }
}

export async function handleMetaStatus(req, res) {
  try {
    const { id } = req.params;
    const status = await getMetaStatus(id);
    sendResponse(res, 200, status);
  } catch (err) {
    sendResponse(res, 500, null, err.message);
  }
}
