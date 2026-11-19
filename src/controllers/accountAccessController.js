import sendResponse from "../utils/sendResponse.js";
import getClientIp from "../utils/getClientIp.js";
import { verifyTurnstile } from "../utils/turnstile.js";
import { AccessError, complete, lookup, sendCode, verify } from "../services/accountAccessService.js";

// Recuperación de acceso del dueño (público, sin organizationResolver: funciona
// desde app.agenditapp.com y desde el login de cualquier subdominio).

function handleError(res, err, where) {
  if (err instanceof AccessError) {
    return sendResponse(res, err.status, { reason: err.code, ...err.extra }, err.message);
  }
  console.error(`[accountAccess] ${where}:`, err);
  return sendResponse(res, 500, null, "Tuvimos un problema. Inténtalo de nuevo en un momento.");
}

const accountAccessController = {
  /** POST /account-access/lookup { identifier, turnstileToken } */
  lookup: async (req, res) => {
    try {
      const { identifier, turnstileToken } = req.body || {};
      if (process.env.NODE_ENV === "production" || turnstileToken) {
        if (!(await verifyTurnstile(turnstileToken))) {
          return sendResponse(res, 400, { reason: "captcha" }, "No pudimos verificar que no eres un robot. Recarga la página.");
        }
      }
      const accounts = await lookup(identifier);
      return sendResponse(res, 200, { accounts }, accounts.length ? "ok" : "Sin coincidencias");
    } catch (err) {
      return handleError(res, err, "lookup");
    }
  },

  /** POST /account-access/send-code { identifier, organizationId, channel } */
  sendCode: async (req, res) => {
    try {
      const { identifier, organizationId, channel } = req.body || {};
      const result = await sendCode({ identifier, organizationId, channel, ip: getClientIp(req) });
      return sendResponse(res, 200, result, "Código enviado");
    } catch (err) {
      return handleError(res, err, "sendCode");
    }
  },

  /** POST /account-access/verify { challengeId, code } | { challengeId, token } */
  verify: async (req, res) => {
    try {
      const { challengeId, code, token } = req.body || {};
      const result = await verify({ challengeId, code, token });
      return sendResponse(res, 200, result, "Código verificado");
    } catch (err) {
      return handleError(res, err, "verify");
    }
  },

  /** POST /account-access/complete { challengeId, completionToken, newPassword? } */
  complete: async (req, res) => {
    try {
      const { challengeId, completionToken, newPassword } = req.body || {};
      const result = await complete({ challengeId, completionToken, newPassword });
      return sendResponse(res, 200, result, "Listo");
    } catch (err) {
      return handleError(res, err, "complete");
    }
  },
};

export default accountAccessController;
