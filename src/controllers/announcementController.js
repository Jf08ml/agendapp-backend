import SystemAnnouncement from "../models/systemAnnouncementModel.js";
import sendResponse from "../utils/sendResponse.js";

// Quita readBy del response y añade viewCount
const toPublicDoc = ({ readBy, ...rest }) => ({ ...rest, viewCount: readBy?.length ?? 0 });

// ── Endpoints públicos (verifyToken, sin membership check) ────────────────

export const getPublished = async (req, res) => {
  try {
    const docs = await SystemAnnouncement.find({ published: true })
      .sort({ isoDate: -1 })
      .lean();
    sendResponse(res, 200, docs.map(toPublicDoc));
  } catch (err) {
    sendResponse(res, 500, null, err.message);
  }
};

export const getLatestDate = async (req, res) => {
  try {
    const latest = await SystemAnnouncement.findOne({ published: true })
      .sort({ isoDate: -1 })
      .select("isoDate")
      .lean();
    sendResponse(res, 200, { isoDate: latest?.isoDate ?? null });
  } catch (err) {
    sendResponse(res, 500, null, err.message);
  }
};

// Marca todos los anuncios publicados como leídos por esta organización
export const markRead = async (req, res) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return sendResponse(res, 200, null); // superadmin u otro — ignorar

    await SystemAnnouncement.updateMany(
      { published: true, readBy: { $ne: orgId } },
      { $addToSet: { readBy: orgId } }
    );
    sendResponse(res, 200, null, "Marcado como leído");
  } catch (err) {
    sendResponse(res, 500, null, err.message);
  }
};

// ── Endpoints superadmin ───────────────────────────────────────────────────

export const adminGetAll = async (req, res) => {
  try {
    const docs = await SystemAnnouncement.find()
      .sort({ isoDate: -1 })
      .lean();
    sendResponse(res, 200, docs.map(toPublicDoc));
  } catch (err) {
    sendResponse(res, 500, null, err.message);
  }
};

export const adminCreate = async (req, res) => {
  try {
    const { version, date, isoDate, items, published } = req.body;
    const doc = await SystemAnnouncement.create({
      version,
      date,
      isoDate,
      items: items ?? [],
      published: !!published,
    });
    sendResponse(res, 201, toPublicDoc(doc.toObject()), "Anuncio creado");
  } catch (err) {
    sendResponse(res, 500, null, err.message);
  }
};

export const adminUpdate = async (req, res) => {
  try {
    const { id } = req.params;
    const { version, date, isoDate, items, published } = req.body;
    const doc = await SystemAnnouncement.findByIdAndUpdate(
      id,
      { version, date, isoDate, items, published },
      { new: true, runValidators: true }
    );
    if (!doc) return sendResponse(res, 404, null, "Anuncio no encontrado");
    sendResponse(res, 200, toPublicDoc(doc.toObject()), "Anuncio actualizado");
  } catch (err) {
    sendResponse(res, 500, null, err.message);
  }
};

export const adminDelete = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await SystemAnnouncement.findByIdAndDelete(id);
    if (!doc) return sendResponse(res, 404, null, "Anuncio no encontrado");
    sendResponse(res, 200, null, "Anuncio eliminado");
  } catch (err) {
    sendResponse(res, 500, null, err.message);
  }
};

export const adminTogglePublish = async (req, res) => {
  try {
    const { id } = req.params;
    const { published } = req.body;
    const doc = await SystemAnnouncement.findByIdAndUpdate(
      id,
      { published: !!published },
      { new: true }
    );
    if (!doc) return sendResponse(res, 404, null, "Anuncio no encontrado");
    sendResponse(res, 200, toPublicDoc(doc.toObject()), published ? "Anuncio publicado" : "Anuncio ocultado");
  } catch (err) {
    sendResponse(res, 500, null, err.message);
  }
};
