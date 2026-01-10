import express from "express";
import clientController from "../controllers/clientController.js";

const router = express.Router();

// Ruta para crear un cliente
router.post("/clients", clientController.createClient);

// Ruta para obtener todos los clientes
router.get("/clients", clientController.getClients);

// Obtener los clientes por organizationId
router.get(
  "/clients/organization/:organizationId",
  clientController.getClientsByOrganizationId
);

// 🚀 Búsqueda optimizada de clientes (con query params: search, limit)
router.get(
  "/clients/organization/:organizationId/search",
  clientController.searchClients
);

// Ruta para obtener un cliente específico por ID
router.get("/clients/:id", clientController.getClientById);

// Ruta para obtener un cliente por número de teléfono y organizacion
router.get(
  "/clients/phone/:phoneNumber/organization/:organizationId",
  clientController.getClientByPhoneNumberAndOrganization
);

// Ruta para actualizar un cliente específico por ID
router.put("/clients/:id", clientController.updateClient);

// Ruta para eliminar un cliente específico por ID
router.delete("/clients/:id", clientController.deleteClient);

// Ruta para registrar un servicio para un cliente
router.post("/clients/:id/register-service", clientController.registerService);

// Ruta para registrar un referido para un cliente
router.post(
  "/clients/:id/register-referral",
  clientController.registerReferral
);

// Ruta para carga masiva de clientes desde Excel
router.post("/clients/bulk-upload", clientController.bulkUploadClients);

export default router;
