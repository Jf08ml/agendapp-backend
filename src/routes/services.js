import express from "express";
import serviceController from "../controllers/serviceController.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// 🌐 Rutas PÚBLICAS (sin autenticación) - Para landing y página de servicios
router.get(
  "/organization/:organizationId",
  serviceController.getServicesByOrganizationId
);
// Vista de detalle de un servicio, pública y compartible (organizationId por
// query string, ya que este router no pasa por organizationResolver).
router.get("/public/:id", serviceController.getPublicServiceById);

// 🔒 Rutas PROTEGIDAS (requieren autenticación)
router.post("/", verifyToken, serviceController.createService);
router.get("/", verifyToken, serviceController.getServices);
router.get("/:id", verifyToken, serviceController.getServiceById);
router.put("/:id", verifyToken, serviceController.updateService);
router.delete("/:id", verifyToken, serviceController.deleteService);
router.post("/bulk-upload", verifyToken, serviceController.bulkUploadServices);

export default router;
