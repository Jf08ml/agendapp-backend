import express from 'express';
import publicCancellationController from '../controllers/publicCancellationController.js';
import loyaltyCardController from '../controllers/loyaltyCardController.js';
import clientBookingsController from '../controllers/clientBookingsController.js';
import { organizationResolver } from '../middleware/organizationResolver.js';

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

// 💳 Tarjeta virtual de fidelidad
// GET /api/public/loyalty-card/:token  → progreso del cliente (sin datos de contacto)
router.get('/loyalty-card/:token', loyaltyCardController.getPublicCard);
// POST /api/public/loyalty-card/request { phone } → envía el enlace por WhatsApp
router.post('/loyalty-card/request', organizationResolver, loyaltyCardController.requestCard);

// 📅 Mis reservas (citas + reservas pendientes + clases del cliente)
// POST /api/public/my-bookings/request { phone } → envía el enlace por WhatsApp
router.post('/my-bookings/request', organizationResolver, clientBookingsController.requestLink);
// POST /api/public/my-bookings/lookup { phone } → consulta de solo lectura (sin cancelar)
router.post('/my-bookings/lookup', organizationResolver, clientBookingsController.lookupByPhone);
// GET /api/public/my-bookings/:token → próximas reservas e historial
router.get('/my-bookings/:token', clientBookingsController.getBookings);
// POST /api/public/my-bookings/:token/cancel { type, id }
router.post('/my-bookings/:token/cancel', clientBookingsController.cancelBooking);

export default router;
