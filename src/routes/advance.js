import express from "express";
import advanceController from "../controllers/advanceController.js";

const router = express.Router();

// Crear un nuevo avance (o ingreso manual)
router.post("/", advanceController.createAdvance);

// Obtener todos los avances/ingresos de un empleado específico
router.get("/employee/:employeeId", advanceController.getAdvancesByEmployee);

// Actualizar un avance/ingreso específico por ID
router.put("/:id", advanceController.updateAdvance);

// Eliminar un avance/ingreso específico por ID
router.delete("/:id", advanceController.deleteAdvance);

export default router;
