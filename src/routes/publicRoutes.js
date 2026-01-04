import express from 'express';
import publicCancellationController from '../controllers/publicCancellationController.js';

const router = express.Router();

/**
 * Rutas públicas de cancelación (sin autenticación)
 */

// GET /api/public/cancel/info?token=XYZ
router.get('/cancel/info', publicCancellationController.getCancellationInfo);

// POST /api/public/cancel
router.post('/cancel', publicCancellationController.cancelByToken);

export default router;
