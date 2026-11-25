import express from "express";
import clientController from "../controllers/clientController.js";
import loyaltyCardController from "../controllers/loyaltyCardController.js";
import clientBookingsController from "../controllers/clientBookingsController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { organizationResolver } from "../middleware/organizationResolver.js";
import { requirePermission, PERMS } from "../middleware/requirePermission.js";

// Permisos del panel (roles a medida · Fase 3). La agenda busca clientes con
// permisos de citas; sellar la tarjeta lo puede hacer cualquiera del equipo.
const can = {
  read: requirePermission(...PERMS.clientsRead),
  search: requirePermission(...PERMS.clientsRead, "inventory:sell"),
  list: requirePermission("clients:read"),
  create: requirePermission(...PERMS.clientsCreate),
  bulk: requirePermission("clients:create"),
  update: requirePermission(...PERMS.clientsUpdate),
  remove: requirePermission(...PERMS.clientsDelete),
  loyalty: requirePermission(...PERMS.clientsLoyalty),
  stamp: requirePermission(...PERMS.loyaltyStamp),
};

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
router.post("/", organizationResolver, verifyToken, can.create, clientController.createClient);
router.get("/", organizationResolver, verifyToken, can.read, clientController.getClients);
router.get(
  "/organization/:organizationId",
  organizationResolver,
  verifyToken,
  can.read,
  clientController.getClientsByOrganizationId
);
router.get(
  "/organization/:organizationId/search",
  organizationResolver,
  verifyToken,
  can.search,
  clientController.searchClients
);
// Antes de "/:id" para que "follow-ups" no se interprete como un id de cliente
router.get("/follow-ups", organizationResolver, verifyToken, can.list, clientController.getOrgFollowUps);
// Cifras por cliente (última visita, visitas, total, paquete) para los segmentos
router.get("/stats", organizationResolver, verifyToken, can.list, clientController.getClientStats);
// 💳 Tarjeta de fidelidad: cliente por token del QR / enlace de su tarjeta
router.get("/loyalty-card/by-token/:token", organizationResolver, verifyToken, can.stamp, loyaltyCardController.getClientByCardToken);
router.get("/:id/loyalty-card", organizationResolver, verifyToken, can.read, loyaltyCardController.getClientCardLink);
router.get("/:id/bookings-link", organizationResolver, verifyToken, can.read, clientBookingsController.getClientBookingsLink);
router.get("/:id", organizationResolver, verifyToken, can.read, clientController.getClientById);
router.get("/:id/follow-up-status", organizationResolver, verifyToken, can.read, clientController.getFollowUpStatus);
router.delete("/:id", organizationResolver, verifyToken, can.remove, clientController.deleteClient);
router.post("/:id/register-service", organizationResolver, verifyToken, can.stamp, clientController.registerService);
router.post(
  "/:id/register-referral",
  organizationResolver,
  verifyToken,
  can.stamp,
  clientController.registerReferral
);
router.post("/:id/loyalty/decrement", organizationResolver, verifyToken, can.loyalty, clientController.decrementLoyalty);
router.put("/:id/rewards/:rewardId/redeem", organizationResolver, verifyToken, can.loyalty, clientController.redeemReward);
router.delete("/:id/rewards/:rewardId", organizationResolver, verifyToken, can.update, clientController.deleteReward);
router.post("/:id/merge/:sourceId", organizationResolver, verifyToken, can.update, clientController.mergeClient);
router.delete("/:id/force", organizationResolver, verifyToken, can.remove, clientController.forceDeleteClient);
router.post("/reset-all", organizationResolver, verifyToken, can.update, clientController.resetAllClientsLoyalty);
router.post("/:id/reset", organizationResolver, verifyToken, can.update, clientController.resetClientLoyalty);
router.post("/bulk-upload", organizationResolver, verifyToken, can.bulk, clientController.bulkUploadClients);

export default router;
