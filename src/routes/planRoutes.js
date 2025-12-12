import express from "express";
import planController from "../controllers/planController.js";

const router = express.Router();

// Crear un nuevo plan
router.post("/", planController.createPlan);

// Obtener todos los planes
router.get("/", planController.getPlans);

// Obtener un plan específico por ID
router.get("/:id", planController.getPlanById);

// Actualizar un plan específico por ID
router.put("/:id", planController.updatePlan);

// Eliminar un plan específico por ID
router.delete("/:id", planController.deletePlan);

export default router;
