import { Router } from "express";
import { getPublished, getLatestDate, markRead } from "../controllers/announcementController.js";

const router = Router();

router.get("/latest-date", getLatestDate);
router.post("/mark-read", markRead);
router.get("/", getPublished);

export default router;
