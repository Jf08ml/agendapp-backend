import Session from "../models/sessionModel.js";

const sessionService = {
  listActiveSessions: async (organizationId) => {
    return Session.find({
      organizationId,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .sort({ lastActiveAt: -1 })
      .lean();
  },

  revokeSession: async (organizationId, sessionId) => {
    return Session.findOneAndUpdate(
      { _id: sessionId, organizationId, revokedAt: null },
      { revokedAt: new Date() },
      { new: true }
    );
  },
};

export default sessionService;
