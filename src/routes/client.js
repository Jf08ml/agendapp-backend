import express from "express";
import clientController from "../controllers/clientController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { organizationResolver } from "../middleware/organizationResolver.js";

const router = express.Router();

// 🌐 Rutas PÚBLICAS (sin autenticación) - Para reserva en línea
router.get(
  "/phone/:phoneNumber/organization/:organizationId",
  clientController.getClientByPhoneNumberAndOrganization
);
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
router.get("/:id", organizationResolver, verifyToken, clientController.getClientById);
router.delete("/:id", organizationResolver, verifyToken, clientController.deleteClient);
router.post("/:id/register-service", organizationResolver, verifyToken, clientController.registerService);
router.post(
  "/:id/register-referral",
  organizationResolver,
  verifyToken,
  clientController.registerReferral
);
router.post("/bulk-upload", organizationResolver, verifyToken, clientController.bulkUploadClients);

export default router;
