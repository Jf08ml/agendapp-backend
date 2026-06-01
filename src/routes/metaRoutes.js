import express from "express";
import {
  handleRequestVerification,
  handleVerifyCode,
  handleActivate,
  handleEmbeddedConnect,
  handleMetaDisconnect,
  handleMetaStatus,
} from "../controllers/metaConnectController.js";
import {
  handleListTemplates,
  handleCreateTemplate,
  handleUpdateTemplate,
  handleDeleteTemplate,
  handleSyncTemplates,
} from "../controllers/metaTemplateController.js";

const router = express.Router();

// ── Conexión Meta — flujo A: SMS/Voz (WABA de plataforma) ─────────
router.post("/:id/meta-request-verification", handleRequestVerification);
router.post("/:id/meta-verify-code", handleVerifyCode);

// ── Conexión Meta — flujo B: Embedded Signup (WABA propio) ────────
router.post("/:id/meta-embedded-connect", handleEmbeddedConnect);

// ── Activación compartida (aplica a ambos flujos) ─────────────────
router.post("/:id/meta-activate", handleActivate);
router.delete("/:id/meta-disconnect", handleMetaDisconnect);
router.get("/:id/meta-status", handleMetaStatus);

// ── Plantillas Meta por org ────────────────────────────────────────
router.get("/:id/meta-templates", handleListTemplates);
router.post("/:id/meta-templates", handleCreateTemplate);
router.patch("/:id/meta-templates/:templateId", handleUpdateTemplate);
router.delete("/:id/meta-templates/:templateName", handleDeleteTemplate);
router.post("/:id/meta-templates/sync", handleSyncTemplates);

export default router;
