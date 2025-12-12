import express from "express";
import notificationController from "../controllers/notificationController.js";

const router = express.Router();

router.post("/notifications", notificationController.createNotification);
router.get("/notifications", notificationController.getNotifications);
router.get("/notifications/user-or-org/:id", notificationController.getNotificationsByUserOrOrganization);
router.get("/notifications/admin/:organizationId", notificationController.getAdminNotifications);
router.get("/notifications/membership/:organizationId", notificationController.getMembershipNotifications);
router.put("/notifications/mark-as-read/:id", notificationController.markAsRead);
router.put("/notifications/mark-all-as-read/:id/:type", notificationController.markAllAsRead);
router.get("/notifications/id/:id", notificationController.getNotificationById);
router.put("/notifications/:id", notificationController.updateNotification);
router.delete("/notifications/:id", notificationController.deleteNotification);

export default router;
