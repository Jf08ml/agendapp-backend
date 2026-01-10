import express from "express";
import serviceController from "../controllers/serviceController.js";

const router = express.Router();

// Ruta para crear un servicio
router.post("/services", serviceController.createService);

// Ruta para obtener todos los servicios
router.get("/services", serviceController.getServices);

// Obtener los servicios por organizationId
router.get(
  "/services/organization/:organizationId",
  serviceController.getServicesByOrganizationId
);

// Ruta para obtener un servicio específico por ID
router.get("/services/:id", serviceController.getServiceById);

// Ruta para actualizar un servicio específico por ID
router.put("/services/:id", serviceController.updateService);

// Ruta para eliminar un servicio específico por ID
router.delete("/services/:id", serviceController.deleteService);

// Ruta para carga masiva de servicios desde Excel
router.post("/services/bulk-upload", serviceController.bulkUploadServices);

export default router;
