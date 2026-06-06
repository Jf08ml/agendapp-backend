import mongoose from "mongoose";

const itemSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["new", "improvement", "fix"], required: true },
    text: { type: String, required: true },
    detail: { type: String, default: "" }, // Explicación extendida opcional
  },
  { _id: false }
);

const systemAnnouncementSchema = new mongoose.Schema(
  {
    version: { type: String, required: true },
    date: { type: String, required: true },    // Texto display: "5 Jun 2026"
    isoDate: { type: String, required: true },  // Para ordenar/comparar: "2026-06-05"
    items: [itemSchema],
    published: { type: Boolean, default: false },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "Organization" }],
  },
  { timestamps: true }
);

systemAnnouncementSchema.index({ isoDate: -1 });

export default mongoose.model("SystemAnnouncement", systemAnnouncementSchema);
