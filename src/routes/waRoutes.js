// routes/waRoutes.js
import express from "express";
import waController from "../controllers/waController.js";
// import { authUser } from "../middlewares/auth.js"; // opcional

const router = express.Router();

router.post("/organizations/:id/connect", waController.connectSession);
router.get("/organizations/:id/status", waController.getStatus);
router.post("/organizations/:id/send", waController.send);
router.post("/organizations/:id/restart", waController.restart);
router.post("/organizations/:id/logout", waController.logout);

export default router;
