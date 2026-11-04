import express from "express";
import clientController from "../controllers/clientController.js";
import loyaltyCardController from "../controllers/loyaltyCardController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { organizationResolver } from "../middleware/organizationResolver.js";

const router = express.Router();

// 🌐 Rutas PÚBLICAS (sin autenticación) - Para reserva en línea
router.get(
  "/phone/:phoneNumber/organization/:organizationId",
  clientController.getClientByPhoneNumberAndOrganization
);
// GET /clients/by-identifier?field=documentId&value=...&organizationId=...
router.get("/by-identifier", clientController.getClientByIdentifier);
router.put("/:id", clientController.updateClient);

// 🔒 Rutas PROTEGIDAS (requieren autenticación)
router.post("/", organizationResolver, verifyToken, clientController.createClient);
router.get("/", organizationResolver, verifyToken, clientController.getClients);
router.get(
  "/organization/:organizationId",
  organizationResolver,
  verifyToken,
  clientController.getClientsByOrganizationId
);
router.get(
  "/organization/:organizationId/search",
  organizationResolver,
  verifyToken,
  clientController.searchClients
);
// Antes de "/:id" para que "follow-ups" no se interprete como un id de cliente
router.get("/follow-ups", organizationResolver, verifyToken, clientController.getOrgFollowUps);
// 💳 Tarjeta de fidelidad: cliente por token del QR / enlace de su tarjeta
router.get("/loyalty-card/by-token/:token", organizationResolver, verifyToken, loyaltyCardController.getClientByCardToken);
router.get("/:id/loyalty-card", organizationResolver, verifyToken, loyaltyCardController.getClientCardLink);
router.get("/:id", organizationResolver, verifyToken, clientController.getClientById);
router.get("/:id/follow-up-status", organizationResolver, verifyToken, clientController.getFollowUpStatus);
router.delete("/:id", organizationResolver, verifyToken, clientController.deleteClient);
router.post("/:id/register-service", organizationResolver, verifyToken, clientController.registerService);
router.post(
  "/:id/register-referral",
  organizationResolver,
  verifyToken,
  clientController.registerReferral
);
router.put("/:id/rewards/:rewardId/redeem", organizationResolver, verifyToken, clientController.redeemReward);
router.delete("/:id/rewards/:rewardId", organizationResolver, verifyToken, clientController.deleteReward);
router.post("/:id/merge/:sourceId", organizationResolver, verifyToken, clientController.mergeClient);
router.delete("/:id/force", organizationResolver, verifyToken, clientController.forceDeleteClient);
router.post("/reset-all", organizationResolver, verifyToken, clientController.resetAllClientsLoyalty);
router.post("/:id/reset", organizationResolver, verifyToken, clientController.resetClientLoyalty);
router.post("/bulk-upload", organizationResolver, verifyToken, clientController.bulkUploadClients);

export default router;
