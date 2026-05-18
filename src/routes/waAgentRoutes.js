import { Router } from "express";
import {
  handleMetaVerify,
  handleMetaIncoming,
  handleBaileysMessage,
} from "../controllers/waAgentController.js";

const router = Router();

// Baileys microservice → backend
router.post("/message", handleBaileysMessage);

// Meta webhook: verificación inicial (GET) + mensajes entrantes de la org (POST)
router.get("/meta-incoming", handleMetaVerify);
router.post("/meta-incoming", handleMetaIncoming);

export default router;
