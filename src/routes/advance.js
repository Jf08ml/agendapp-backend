import express from "express";
import advanceController from "../controllers/advanceController.js";
import { requirePermission, requireOwnOrPermission, PERMS } from "../middleware/requirePermission.js";

const router = express.Router();

// Crear un nuevo avance (o ingreso manual)
router.post("/", requirePermission(...PERMS.advancesWrite), advanceController.createAdvance);

// Obtener todos los avances/ingresos de un empleado específico
router.get("/employee/:employeeId", requireOwnOrPermission("employeeId", PERMS.advancesReadOthers), advanceController.getAdvancesByEmployee);

// Actualizar un avance/ingreso específico por ID
router.put("/:id", requirePermission(...PERMS.advancesWrite), advanceController.updateAdvance);

// Eliminar un avance/ingreso específico por ID
router.delete("/:id", requirePermission(...PERMS.advancesWrite), advanceController.deleteAdvance);

export default router;
