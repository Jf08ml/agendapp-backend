import express from "express";
import notificationController from "../controllers/notificationController.js";

const router = express.Router();

router.post("/", notificationController.createNotification);
router.get("/", notificationController.getNotifications);
router.get("/user-or-org/:id", notificationController.getNotificationsByUserOrOrganization);
router.get("/admin/:organizationId", notificationController.getAdminNotifications);
router.get("/membership/:organizationId", notificationController.getMembershipNotifications);
router.put("/mark-as-read/:id", notificationController.markAsRead);
router.put("/mark-all-as-read/:id/:type", notificationController.markAllAsRead);
router.get("/id/:id", notificationController.getNotificationById);
router.put("/:id", notificationController.updateNotification);
router.delete("/:id", notificationController.deleteNotification);

export default router;
