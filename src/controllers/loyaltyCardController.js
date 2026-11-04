import sendResponse from "../utils/sendResponse.js";
import Client from "../models/clientModel.js";
import loyaltyCardService from "../services/loyaltyCardService.js";

// GET /public/loyalty-card/:token   (público)
export const getPublicCard = async (req, res) => {
  try {
    const card = await loyaltyCardService.getPublicCard(req.params.token);
    if (!card) return sendResponse(res, 404, null, "Tarjeta no encontrada.");
    return sendResponse(res, 200, card, "Tarjeta de fidelidad.");
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

// POST /public/loyalty-card/request  { phone }   (público, con organizationResolver)
export const requestCard = async (req, res) => {
  try {
    const org = req.organization;
    if (!org) return sendResponse(res, 400, null, "Organización no encontrada.");
    if (org.showLoyaltyProgram === false) {
      return sendResponse(res, 403, null, "El programa de fidelidad no está activo.");
    }
    const phone = String(req.body?.phone || "").trim();
    if (!phone || phone.length > 25) return sendResponse(res, 400, null, "Teléfono inválido.");

    const result = await loyaltyCardService.requestCardByPhone(org, phone);
    if (result.status === "not_found") {
      return sendResponse(res, 404, null, "No encontramos un cliente con ese número.");
    }
    return sendResponse(res, 200, result, "OK");
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

// GET /clients/:id/loyalty-card   (admin) → { url, token }
export const getClientCardLink = async (req, res) => {
  try {
    const client = await Client.findOne({ _id: req.params.id, organizationId: req.organization._id });
    if (!client) return sendResponse(res, 404, null, "Cliente no encontrado.");
    const token = await loyaltyCardService.ensureLoyaltyCardToken(client);
    return sendResponse(
      res,
      200,
      { token, url: loyaltyCardService.buildLoyaltyCardUrl(req.organization, token) },
      "Enlace de la tarjeta."
    );
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

// GET /clients/loyalty-card/by-token/:token   (admin, tras escanear el QR)
export const getClientByCardToken = async (req, res) => {
  try {
    const client = await loyaltyCardService.getClientByCardToken(req.organization._id, req.params.token);
    if (!client) return sendResponse(res, 404, null, "La tarjeta no pertenece a un cliente de este negocio.");
    return sendResponse(res, 200, client, "Cliente.");
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

export default { getPublicCard, requestCard, getClientCardLink, getClientByCardToken };
