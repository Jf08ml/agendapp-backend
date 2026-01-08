// controllers/membershipBillingController.js
import sendResponse from "../utils/sendResponse.js";

// Lee cuentas de transferencia para membresía desde variables de entorno
// Puedes definir:
// MEMBERSHIP_BILLING_COP_ACCOUNTS_JSON = JSON.stringify([
//   { type: "nequi", label: "Nequi", accountName: "Nombre", accountNumber: "3001234567" },
//   { type: "bancolombia", label: "Bancolombia", accountName: "Nombre", accountNumber: "1234567890", bank: "Bancolombia" }
// ])
// MEMBERSHIP_BILLING_WHATSAPP = "+57XXXXXXXXXX"

function loadCopAccounts() {
  try {
    const raw = process.env.MEMBERSHIP_BILLING_COP_ACCOUNTS_JSON;
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr;
    return [];
  } catch {
    return [];
  }
}

const membershipBillingController = {
  // GET /api/billing/public
  getPublicBillingInfo: async (req, res) => {
    try {
      const copAccounts = loadCopAccounts();
      const whatsapp = process.env.MEMBERSHIP_BILLING_WHATSAPP || null;
      const currency = "USD"; // Polar
      return sendResponse(
        res,
        200,
        {
          polarCurrency: currency,
          copTransfers: {
            accounts: copAccounts,
            whatsapp,
            note: "Pagos de membresía por transferencia son gestionados por el equipo de la plataforma.",
          },
        },
        "Billing info pública"
      );
    } catch (err) {
      return sendResponse(res, 500, null, err.message);
    }
  },
};

export default membershipBillingController;
