import express from "express";
import planController from "../controllers/planController.js";

const router = express.Router();

// Crear un nuevo plan
router.post("/plans", planController.createPlan);

// Obtener todos los planes
router.get("/plans", planController.getPlans);

// Obtener un plan específico por ID
router.get("/plans/:id", planController.getPlanById);

// Actualizar un plan específico por ID
router.put("/plans/:id", planController.updatePlan);

// Eliminar un plan específico por ID
router.delete("/plans/:id", planController.deletePlan);

export default router;
