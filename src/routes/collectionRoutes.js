import express from "express";
import {
  getMpConnectUrl,
  mpStatus,
  mpDisconnect,
} from "../controllers/collectionController.js";

// Rutas de cobro por-org (admin autenticado). Se montan bajo /organizations
// con organizationResolver + verifyToken (grupo "auth sin membership check").
// NOTA: la bandeja de comprobantes vive en su propio mount /receipts
// (receiptAdminRoutes) porque `GET /organizations/:id` capturaría /receipts.
const router = express.Router();

router.get("/:id/mp/connect", getMpConnectUrl);
router.get("/:id/mp/status", mpStatus);
router.post("/:id/mp/disconnect", mpDisconnect);

export default router;
