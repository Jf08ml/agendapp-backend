// routes/waRoutes.js
import express from "express";
import waController from "../controllers/waController.js";
// import { authUser } from "../middlewares/auth.js"; // opcional

const router = express.Router();

router.post("/organizations/:id/wa/connect", waController.connectSession);
router.get("/organizations/:id/wa/status", waController.getStatus);
router.post("/organizations/:id/wa/send", waController.send);
router.post("/organizations/:id/wa/restart", waController.restart);
router.post("/organizations/:id/wa/logout", waController.logout);

export default router;
