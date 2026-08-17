import FeatureRequest from "../models/featureRequestModel.js";
import sendResponse from "../utils/sendResponse.js";
import { resolveOrgContext } from "../utils/resolveOrgContext.js";

// ── Endpoints de organización (verifyToken, sin membership check) ─────────

export const create = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return sendResponse(res, 400, null, "El texto de la solicitud no puede estar vacío");
    }

    const ctx = await resolveOrgContext(req.user);
    if (!ctx) {
      return sendResponse(res, 400, null, "No se pudo determinar la organización del usuario");
    }

    const doc = await FeatureRequest.create({
      organizationId: ctx.organizationId,
      text: text.trim(),
      submittedById: req.user.userId,
      submittedByName: ctx.name,
      submittedByRole: ctx.role,
    });

    sendResponse(res, 201, doc.toObject(), "Solicitud enviada");
  } catch (err) {
    sendResponse(res, 500, null, err.message);
  }
};

export const getMine = async (req, res) => {
  try {
    const ctx = await resolveOrgContext(req.user);
    if (!ctx) return sendResponse(res, 200, []);

    const docs = await FeatureRequest.find({ organizationId: ctx.organizationId })
      .sort({ createdAt: -1 })
      .lean();
    sendResponse(res, 200, docs);
  } catch (err) {
    sendResponse(res, 500, null, err.message);
  }
};

export const closeMine = async (req, res) => {
  try {
    const { id } = req.params;
    const ctx = await resolveOrgContext(req.user);
    if (!ctx) {
      return sendResponse(res, 400, null, "No se pudo determinar la organización del usuario");
    }

    // Scoped por organizationId: una org solo puede cerrar sus propias solicitudes.
    const doc = await FeatureRequest.findOneAndUpdate(
      { _id: id, organizationId: ctx.organizationId },
      { $set: { closedByOrg: true, closedByOrgAt: new Date() } },
      { new: true }
    );
    if (!doc) return sendResponse(res, 404, null, "Solicitud no encontrada");

    sendResponse(res, 200, doc.toObject(), "Solicitud cerrada");
  } catch (err) {
    sendResponse(res, 500, null, err.message);
  }
};

// ── Endpoints superadmin ────────────────────────────────────────────────

export const adminGetAll = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const docs = await FeatureRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate("organizationId", "name")
      .lean();
    sendResponse(res, 200, docs);
  } catch (err) {
    sendResponse(res, 500, null, err.message);
  }
};

export const adminUpdateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminReply } = req.body;

    const set = {};
    if (status !== undefined) set.status = status;
    if (adminReply !== undefined) set.adminReply = adminReply;
    if (status !== undefined || (adminReply !== undefined && adminReply.trim())) {
      set.respondedAt = new Date();
    }

    const doc = await FeatureRequest.findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true })
      .populate("organizationId", "name");
    if (!doc) return sendResponse(res, 404, null, "Solicitud no encontrada");

    sendResponse(res, 200, doc.toObject(), "Solicitud actualizada");
  } catch (err) {
    sendResponse(res, 500, null, err.message);
  }
};
