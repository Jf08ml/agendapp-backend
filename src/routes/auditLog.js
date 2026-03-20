import express from "express";
import auditLogController from "../controllers/auditLogController.js";

const router = express.Router();

// GET /api/audit-logs — requiere organizationResolver + verifyToken (definido en indexRoutes)
router.get("/", auditLogController.getAuditLogs);

export default router;
