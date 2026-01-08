// routes/membershipBillingRoutes.js
import { Router } from "express";
import membershipBillingController from "../controllers/membershipBillingController.js";

const router = Router();

router.get("/public", membershipBillingController.getPublicBillingInfo);

export default router;
