// src/models/impactSurveyResponseModel.js
//
// Respuesta del admin de una organización a la encuesta del "reporte de impacto".
// Un doc por org (unique): o respondió ("answered"), o lo pospuso ("snoozed" con
// snoozedUntil). No hay descarte permanente — el objetivo es que respondan todas,
// así que tras el enfriamiento el modal vuelve a aparecer. Sirve para (a) decidir
// si mostrar el modal y (b) seguimiento (qué usaban antes, percepción de
// inasistencias). La agregación/claim de marketing se hará después sobre estos docs.

import mongoose from "mongoose";

const impactSurveyResponseSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      unique: true,
      index: true,
    },
    // Id del usuario admin que respondió (string del JWT, no se castea a ObjectId).
    respondedByUserId: { type: String, default: null },
    status: { type: String, enum: ["answered", "snoozed"], required: true },
    // Cuándo vuelve a aparecer el modal si se pospuso (solo aplica a status "snoozed").
    snoozedUntil: { type: Date, default: null },
    // Snapshot de lo que se le mostró, para interpretar la respuesta más adelante.
    reportSnapshot: {
      daysActive: { type: Number, default: null },
      totalAppointments: { type: Number, default: null },
      onlineCount: { type: Number, default: null },
      onlinePct: { type: Number, default: null },
      noShowApplicable: { type: Boolean, default: false },
      noShowRate: { type: Number, default: null },
    },
    answers: {
      // ¿qué usabas antes?: papel | excel | whatsapp | otra_app | nada | otro
      previousTool: { type: String, default: null },
      previousToolOther: { type: String, default: null },
      // ¿menos inasistencias?: mucho_menos | algo_menos | igual | mas | no_se
      fewerNoShows: { type: String, default: null },
      // ¿qué mejoró más? (multi, opcional)
      biggestImprovement: { type: [String], default: [] },
      comment: { type: String, default: null },
    },
  },
  { timestamps: true }
);

export default mongoose.model("ImpactSurveyResponse", impactSurveyResponseSchema);
