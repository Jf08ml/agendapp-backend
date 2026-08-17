import { Router } from "express";
import { create, getMine, closeMine } from "../controllers/featureRequestController.js";

const router = Router();

router.post("/", create);
router.get("/", getMine);
router.patch("/:id/close", closeMine);

export default router;
