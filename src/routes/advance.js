import express from "express";
import advanceController from "../controllers/advanceController.js";

const router = express.Router();

// Crear un nuevo avance
router.post("/advances", advanceController.createAdvance);

// Obtener todos los avances
router.get("/advances", advanceController.getAdvances);

// Obtener un avance específico por ID
router.get("/advances/:id", advanceController.getAdvanceById);

// Obtener todos los avances de un empleado específico
router.get("/advances/employee/:employeeId", advanceController.getAdvancesByEmployee);

// Actualizar un avance específico por ID
router.put("/advances/:id", advanceController.updateAdvance);

// Eliminar un avance específico por ID
router.delete("/advances/:id", advanceController.deleteAdvance);

export default router;
