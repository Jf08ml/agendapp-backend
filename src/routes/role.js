import express from "express";
import roleController from "../controllers/roleController.js";
import { verifyToken, requireSuperAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// Los roles son globales (los comparten todos los negocios: admin, empleado…).
// Antes estas rutas no pedían sesión: cualquiera podía crear, cambiar los
// permisos o borrar un rol de todos los negocios. Ahora solo el superadmin.
// El frontend no las usa; los permisos llegan con el login.
router.use(verifyToken, requireSuperAdmin);

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
