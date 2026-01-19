import express from "express";
import { uploadImage, getAuthParams } from "../controllers/imageController.js";
import upload from "../middleware/uploadMiddleware.js";

const router = express.Router();

router.post("/upload/:folder", upload.single("file"), uploadImage);
router.get("/auth", getAuthParams);

export default router;
