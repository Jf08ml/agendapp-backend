import express from "express";
import authController from "../controllers/authController";

const router = express.Router();

// Ruta de inicio de sesión
router.post("/login", authController.login);

export default router;
