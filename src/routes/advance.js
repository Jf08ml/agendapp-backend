import express from "express";
import advanceController from "../controllers/advanceController.js";

const router = express.Router();

// Crear un nuevo avance
router.post("/", advanceController.createAdvance);

// Obtener todos los avances
router.get("/", advanceController.getAdvances);

// Obtener un avance específico por ID
router.get("/:id", advanceController.getAdvanceById);

// Obtener todos los avances de un empleado específico
router.get("/employee/:employeeId", advanceController.getAdvancesByEmployee);

// Actualizar un avance específico por ID
router.put("/:id", advanceController.updateAdvance);

// Eliminar un avance específico por ID
router.delete("/:id", advanceController.deleteAdvance);

export default router;
