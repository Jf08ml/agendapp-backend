import express from "express";
import debugController from "../controllers/debugController.js";

const router = express.Router();

// Debug endpoint para investigar slots
router.get("/slots", debugController.debugSlots);

export default router;
