import sendResponse from "../utils/sendResponse.js";
import clientBookingsService from "../services/clientBookingsService.js";

// POST /public/my-bookings/request  { phone }   (público, con organizationResolver)
export const requestLink = async (req, res) => {
  try {
    const org = req.organization;
    if (!org) return sendResponse(res, 400, null, "Organización no encontrada.");
    const phone = String(req.body?.phone || "").trim();
    if (!phone || phone.length > 25) return sendResponse(res, 400, null, "Teléfono inválido.");

    const result = await clientBookingsService.requestBookingsLink(org, phone);
    if (result.status === "not_found") {
      return sendResponse(res, 404, null, "No encontramos reservas con ese número.");
    }
    return sendResponse(res, 200, result, "OK");
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

// POST /public/my-bookings/lookup  { phone }   (público, con organizationResolver)
// Solo lectura: ver reservas con el teléfono. Para cancelar hace falta el enlace.
export const lookupByPhone = async (req, res) => {
  try {
    const org = req.organization;
    if (!org) return sendResponse(res, 400, null, "Organización no encontrada.");
    const phone = String(req.body?.phone || "").trim();
    if (!phone || phone.length > 25) return sendResponse(res, 400, null, "Teléfono inválido.");
    const data = await clientBookingsService.lookupBookingsByPhone(org, phone);
    if (!data) return sendResponse(res, 404, null, "No encontramos reservas con ese número.");
    return sendResponse(res, 200, data, "Mis reservas.");
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

// GET /public/my-bookings/:token   (público)
export const getBookings = async (req, res) => {
  try {
    const data = await clientBookingsService.getBookings(req.params.token);
    if (!data) return sendResponse(res, 404, null, "Enlace inválido.");
    return sendResponse(res, 200, data, "Mis reservas.");
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

// POST /public/my-bookings/:token/cancel  { type, id }   (público)
export const cancelBooking = async (req, res) => {
  try {
    const { type, id } = req.body || {};
    const result = await clientBookingsService.cancelBooking(req.params.token, type, id);
    return sendResponse(res, result.status || (result.success ? 200 : 400), null, result.message);
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

// GET /clients/:id/bookings-link   (admin) → { url, token }
export const getClientBookingsLink = async (req, res) => {
  try {
    const link = await clientBookingsService.getClientBookingsLink(req.organization, req.params.id);
    if (!link) return sendResponse(res, 404, null, "Cliente no encontrado.");
    return sendResponse(res, 200, link, "Enlace de reservas.");
  } catch (err) {
    return sendResponse(res, 400, null, err.message);
  }
};

export default { requestLink, lookupByPhone, getBookings, cancelBooking, getClientBookingsLink };
