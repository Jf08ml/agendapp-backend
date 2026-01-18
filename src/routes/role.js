import express from "express";
import roleController from "../controllers/roleController.js";

const router = express.Router();

// Ruta para crear un nuevo rol
router.post("/", roleController.createRole);

// Ruta para obtener todos los roles
router.get("/", roleController.getAllRoles);

// Ruta para obtener un rol específico por ID
router.get("/:roleId", roleController.getRoleById);

// Ruta para actualizar un rol específico por ID
router.put("/:roleId", roleController.updateRole);

// Ruta para eliminar un rol específico por ID
router.delete("/:roleId", roleController.deleteRole);

export default router;
