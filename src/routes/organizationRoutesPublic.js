import express from "express";
import organizationController from "../controllers/organizationController.js";

const router = express.Router();

// Ruta para obtener todas las organizaciones
router.get("/organizations-public", organizationController.getOrganizations);

// Ruta para obtener una organización específica por ID
router.get("/organizations-public/:id", organizationController.getOrganizationById);


export default router;
