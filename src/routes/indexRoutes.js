import { Router } from "express";
import clientRoutes from "./client"
import appointmentRoutes from "./appointments"
import serviceRoutes from "./services"
import imagesRoutes from "./images"
import employeeRoutes from "./employee"
import advanceRoutes from "./advance"
import roleRoutes from "./role"
import organizationRoutes from "./organizationRoutes"
import authRoutes from "./authRoutes"
import subscriptionRoutes from "./subscriptionRoutes"
import whatsappRoutes from "./whatsappRoutes"
import cronRoutes from "./cronRoutes"
import reservationRoutes from "./reservation"
import notificationRoutes from "./notification"
import planRoutes from "./planRoutes"

const router = Router();

router.use(clientRoutes);
router.use(appointmentRoutes);
router.use(serviceRoutes);
router.use(imagesRoutes);
router.use(employeeRoutes);
router.use(advanceRoutes);
router.use(roleRoutes);
router.use(organizationRoutes);
router.use(authRoutes);
router.use(subscriptionRoutes);
router.use(whatsappRoutes);
router.use(cronRoutes);
router.use(reservationRoutes);
router.use(notificationRoutes);
router.use(planRoutes);

export default router;
