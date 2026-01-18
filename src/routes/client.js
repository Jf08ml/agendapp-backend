import express from "express";
import clientController from "../controllers/clientController.js";

const router = express.Router();

// Ruta para crear un cliente
router.post("/", clientController.createClient);

// Ruta para obtener todos los clientes
router.get("/", clientController.getClients);

// Obtener los clientes por organizationId
router.get(
  "/organization/:organizationId",
  clientController.getClientsByOrganizationId
);

// 🚀 Búsqueda optimizada de clientes (con query params: search, limit)
router.get(
  "/organization/:organizationId/search",
  clientController.searchClients
);

// Ruta para obtener un cliente específico por ID
router.get("/:id", clientController.getClientById);

// Ruta para obtener un cliente por número de teléfono y organizacion
router.get(
  "/phone/:phoneNumber/organization/:organizationId",
  clientController.getClientByPhoneNumberAndOrganization
);

// Ruta para actualizar un cliente específico por ID
router.put("/:id", clientController.updateClient);

// Ruta para eliminar un cliente específico por ID
router.delete("/:id", clientController.deleteClient);

// Ruta para registrar un servicio para un cliente
router.post("/:id/register-service", clientController.registerService);

// Ruta para registrar un referido para un cliente
router.post(
  "/:id/register-referral",
  clientController.registerReferral
);

// Ruta para carga masiva de clientes desde Excel
router.post("/bulk-upload", clientController.bulkUploadClients);

export default router;
