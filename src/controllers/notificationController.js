import notificationService from "../services/notificationService.js";
import sendResponse from "../utils/sendResponse.js";

const notificationController = {
  // Crear una nueva notificación
  createNotification: async (req, res) => {
    try {
      const newNotification = await notificationService.createNotification(
        req.body
      );
      sendResponse(
        res,
        201,
        newNotification,
        "Notificación creada exitosamente"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Obtener todas las notificaciones
  getNotifications: async (req, res) => {
    try {
      const notifications = await notificationService.getNotifications();
      sendResponse(
        res,
        200,
        notifications,
        "Notificaciones obtenidas exitosamente"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Obtener notificaciones por ID (employeeId u organizationId)
  getNotificationsByUserOrOrganization: async (req, res) => {
    const { id } = req.params; // ID del empleado u organización
    const { type } = req.query; // Tipo de filtro: 'employee' o 'organization'

    try {
      let notifications;

      // Filtrar por tipo
      if (type === "employee") {
        notifications = await notificationService.getNotificationsByEmployee(
          id
        );
      } else if (type === "organization") {
        notifications =
          await notificationService.getNotificationsByOrganization(id);
      } else {
        return sendResponse(
          res,
          400,
          null,
          "Tipo de filtro inválido. Usa 'employee' o 'organization'."
        );
      }

      sendResponse(
        res,
        200,
        notifications,
        `Notificaciones obtenidas exitosamente para ${type} con ID: ${id}`
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Obtener una notificación por ID
  getNotificationById: async (req, res) => {
    const { id } = req.params;
    try {
      const notification = await notificationService.getNotificationById(id);
      sendResponse(res, 200, notification, "Notificación encontrada");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Actualizar una notificación
  updateNotification: async (req, res) => {
    const { id } = req.params;
    try {
      const updatedNotification = await notificationService.updateNotification(
        id,
        req.body
      );
      sendResponse(
        res,
        200,
        updatedNotification,
        "Notificación actualizada exitosamente"
      );
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Marcar una notificación como leída
  markAsRead: async (req, res) => {
    const { id } = req.params; // ID de la notificación
    try {
      const updatedNotification = await notificationService.markAsRead(id);
      if (!updatedNotification) {
        return sendResponse(res, 404, null, "Notificación no encontrada");
      }
      sendResponse(
        res,
        200,
        updatedNotification,
        "Notificación marcada como leída"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Marcar todas las notificaciones como leídas
  markAllAsRead: async (req, res) => {
    const { id, type } = req.params; // ID del empleado u organización y tipo
    try {
      let updatedNotifications;
      if (type === "organization") {
        updatedNotifications =
          await notificationService.markAllAsReadByOrganization(id);
      } else if (type === "employee") {
        updatedNotifications =
          await notificationService.markAllAsReadByEmployee(id);
      } else {
        return sendResponse(
          res,
          400,
          null,
          "Tipo inválido. Usa 'organization' o 'employee'."
        );
      }

      sendResponse(
        res,
        200,
        updatedNotifications,
        "Todas las notificaciones marcadas como leídas"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Eliminar una notificación
  deleteNotification: async (req, res) => {
    const { id } = req.params;
    try {
      const result = await notificationService.deleteNotification(id);
      sendResponse(
        res,
        200,
        null,
        result.message || "Notificación eliminada exitosamente"
      );
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Obtener notificaciones del admin/organización (sin employeeId)
  getAdminNotifications: async (req, res) => {
    const { organizationId } = req.params;
    try {
      const notifications = await notificationService.getAdminNotifications(organizationId);
      sendResponse(
        res,
        200,
        notifications,
        "Notificaciones del admin obtenidas exitosamente"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Obtener solo notificaciones de membresía
  getMembershipNotifications: async (req, res) => {
    const { organizationId } = req.params;
    try {
      const notifications = await notificationService.getMembershipNotifications(organizationId);
      sendResponse(
        res,
        200,
        notifications,
        "Notificaciones de membresía obtenidas exitosamente"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },
};

export default notificationController;
