import AuditLog from "../models/auditLogModel.js";
import sendResponse from "../utils/sendResponse.js";

const auditLogController = {
  /**
   * GET /api/audit-logs
   * Retorna los logs de auditoría de la organización con filtros opcionales.
   * Query params: entityType, action, startDate, endDate, page, limit
   */
  getAuditLogs: async (req, res) => {
    try {
      const organizationId = req.organization._id;
      const {
        entityType,
        action,
        startDate,
        endDate,
        page = 1,
        limit = 50,
      } = req.query;

      const query = { organizationId };

      if (entityType) query.entityType = entityType;
      if (action) query.action = action;

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          query.createdAt.$lte = end;
        }
      }

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const skip = (pageNum - 1) * limitNum;

      const [logs, total] = await Promise.all([
        AuditLog.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        AuditLog.countDocuments(query),
      ]);

      sendResponse(res, 200, {
        logs,
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
      });
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },
};

export default auditLogController;
