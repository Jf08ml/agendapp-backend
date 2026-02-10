import express from "express";
import packageController from "../controllers/packageController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { organizationResolver } from "../middleware/organizationResolver.js";

const router = express.Router();

// Rutas públicas (para reserva online)
router.get(
  "/public/client-check",
  organizationResolver,
  packageController.checkClientPackagesPublic
);

// Rutas protegidas (admin)
router.post("/", verifyToken, packageController.createServicePackage);
router.get(
  "/organization/:organizationId",
  verifyToken,
  packageController.getServicePackages
);
router.get("/:id", verifyToken, packageController.getServicePackageById);
router.put("/:id", verifyToken, packageController.updateServicePackage);
router.delete("/:id", verifyToken, packageController.deleteServicePackage);

// Asignación, cancelación y consulta de paquetes de clientes
router.post("/assign", verifyToken, packageController.assignPackageToClient);
router.put("/client-package/:id/cancel", verifyToken, packageController.cancelClientPackage);
router.delete("/client-package/:id", verifyToken, packageController.deleteClientPackage);
router.get(
  "/client/:clientId",
  verifyToken,
  packageController.getClientPackages
);
router.get(
  "/client/:clientId/service/:serviceId",
  verifyToken,
  packageController.getActivePackagesForService
);

export default router;
