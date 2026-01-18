import express from "express";
import employeeController from "../controllers/employeeController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { organizationResolver } from "../middleware/organizationResolver.js";

const router = express.Router();

// 🌐 Rutas PÚBLICAS (sin autenticación) - Para reserva en línea
router.get(
  "/organization/:organizationId",
  employeeController.getEmployeesByOrganizationId
);

// 🔒 Rutas PROTEGIDAS (requieren autenticación)
router.post("/", organizationResolver, verifyToken, employeeController.createEmployee);
router.get("/", organizationResolver, verifyToken, employeeController.getEmployees);
router.get("/:id", organizationResolver, verifyToken, employeeController.getEmployeeById);
router.get(
  "/phone/:phoneNumber",
  organizationResolver,
  verifyToken,
  employeeController.getEmployeeByPhoneNumber
);
router.put("/:id", organizationResolver, verifyToken, employeeController.updateEmployee);
router.delete("/:id", organizationResolver, verifyToken, employeeController.deleteEmployee);

export default router;
