import express from "express";
import packageController from "../controllers/packageController.js";
import { listPublicPackages, createPackageCheckout } from "../controllers/collectionController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { organizationResolver } from "../middleware/organizationResolver.js";

const router = express.Router();

// Compra pública de paquetes (pagados online vía Mercado Pago)
router.get("/public/list", organizationResolver, listPublicPackages);
router.post("/public/checkout", createPackageCheckout);

// Rutas públicas (para reserva online)
router.get(
  "/public/client-check",
  organizationResolver,
  packageController.checkClientPackagesPublic
);
router.get(
  "/public/client-check-by-identifier",
  organizationResolver,
  packageController.checkClientPackagesByIdentifierPublic
);
router.get(
  "/public/client-class-check",
  organizationResolver,
  packageController.checkClientClassPackagesPublic
);
router.get(
  "/public/client-class-check-by-identifier",
  organizationResolver,
  packageController.checkClientClassPackagesByIdentifierPublic
);

// Rutas protegidas (admin)
router.post("/", verifyToken, packageController.createServicePackage);
router.get(
  "/organization/:organizationId",
  verifyToken,
  packageController.getServicePackages
);
router.get(
  "/organization/:organizationId/assigned",
  verifyToken,
  packageController.getAllOrgClientPackages
);
router.get("/:id", verifyToken, packageController.getServicePackageById);
router.put("/:id", verifyToken, packageController.updateServicePackage);
router.delete("/:id", verifyToken, packageController.deleteServicePackage);

// Asignación, cancelación y consulta de paquetes de clientes
router.post("/assign", verifyToken, packageController.assignPackageToClient);
router.put("/client-package/:id/cancel", verifyToken, packageController.cancelClientPackage);
router.post("/client-package/:id/payments", verifyToken, packageController.addPayment);
router.delete("/client-package/:id/payments/:paymentId", verifyToken, packageController.removePayment);
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
router.get(
  "/client/:clientId/class/:classId",
  verifyToken,
  packageController.getActivePackagesForClass
);

export default router;
