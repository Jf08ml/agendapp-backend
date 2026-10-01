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

// POST /api/public/cancel/confirm
router.post('/cancel/confirm', publicCancellationController.confirmByToken);

// Reagendamiento por el cliente (mismo token)
router.get('/cancel/reschedule-info', publicCancellationController.getRescheduleInfo);
router.post('/cancel/reschedule/slots', publicCancellationController.getRescheduleSlots);
router.post('/cancel/reschedule', publicCancellationController.rescheduleByToken);

export default router;
