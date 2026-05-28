import express from "express";
import { handleMetaConnect, handleMetaDisconnect, handleMetaStatus, handleRegisterPhone } from "../controllers/metaConnectController.js";
import { handleListTemplates, handleCreateTemplate, handleUpdateTemplate, handleDeleteTemplate, handleSyncTemplates } from "../controllers/metaTemplateController.js";

const router = express.Router();

// ── Conexión Meta por org ──────────────────────────────────────────
router.post("/:id/meta-connect", handleMetaConnect);
router.post("/:id/meta-register-phone", handleRegisterPhone);
router.delete("/:id/meta-disconnect", handleMetaDisconnect);
router.get("/:id/meta-status", handleMetaStatus);

// ── Plantillas Meta por org ────────────────────────────────────────
router.get("/:id/meta-templates", handleListTemplates);
router.post("/:id/meta-templates", handleCreateTemplate);
router.patch("/:id/meta-templates/:templateId", handleUpdateTemplate);
router.delete("/:id/meta-templates/:templateName", handleDeleteTemplate);
router.post("/:id/meta-templates/sync", handleSyncTemplates);

export default router;
