import Notification from "../models/notificationModel";

const notificationService = {
  createNotification: async (data) => {
    return await Notification.create(data);
  },

  getNotifications: async () => {
    return await Notification.find();
  },

  // Obtener notificaciones por employeeId
  getNotificationsByEmployee: async (employeeId) => {
    return await Notification.find({ employeeId });
  },

  // Obtener notificaciones por organizationId
  getNotificationsByOrganization: async (organizationId) => {
    return await Notification.find({ organizationId });
  },

  getNotificationById: async (id) => {
    return await Notification.findById(id);
  },

  updateNotification: async (id, data) => {
    return await Notification.findByIdAndUpdate(id, data, { new: true });
  },

  // Marcar notificación como leída
  markAsRead: async (id) => {
    return await Notification.findByIdAndUpdate(
      id,
      { status: "read" },
      { new: true }
    );
  },

  // Marcar todas las notificaciones como leídas por organización
  markAllAsReadByOrganization: async (organizationId) => {
    return await Notification.updateMany(
      { organizationId, status: "unread" },
      { status: "read" }
    );
  },

  // Marcar todas las notificaciones como leídas por empleado
  markAllAsReadByEmployee: async (employeeId) => {
    return await Notification.updateMany(
      { employeeId, status: "unread" },
      { status: "read" }
    );
  },

  deleteNotification: async (id) => {
    return await Notification.findByIdAndDelete(id);
  },
};

export default notificationService;
