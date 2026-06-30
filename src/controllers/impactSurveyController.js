// src/controllers/impactSurveyController.js
//
// Endpoints cara-al-cliente de la encuesta del reporte de impacto (admin de la org).
// El reporte se calcula al vuelo desde computeOrgImpactReport; las respuestas se
// persisten en ImpactSurveyResponse (un doc por org).

import sendResponse from "../utils/sendResponse.js";
import ImpactSurveyResponse from "../models/impactSurveyResponseModel.js";
import { computeOrgImpactReport } from "../services/impactReportService.js";

// Cuánto se pospone el modal al elegir "responder en otro momento" (o cerrar).
// Tras este enfriamiento, vuelve a aparecer (no hay descarte permanente).
const SNOOZE_DAYS = 3;

const impactSurveyController = {
  /**
   * GET /api/impact-survey/me
   * Devuelve si se debe mostrar el modal y, en ese caso, el reporte de impacto.
   * show = la org es elegible Y (no respondió) Y (no está pospuesto vigente).
   */
  getMine: async (req, res) => {
    try {
      const orgId = req.organization?._id;
      if (!orgId) return sendResponse(res, 400, null, "Organización no resuelta");

      const now = new Date();
      const existing = await ImpactSurveyResponse.findOne({ organizationId: orgId })
        .select("status snoozedUntil")
        .lean();

      // Ya respondió → nunca más.
      if (existing?.status === "answered") {
        return sendResponse(res, 200, { show: false, alreadyResponded: true, report: null });
      }
      // Pospuesto y el enfriamiento aún no vence → no mostrar todavía.
      if (existing?.status === "snoozed" && existing.snoozedUntil && existing.snoozedUntil > now) {
        return sendResponse(res, 200, { show: false, alreadyResponded: false, report: null });
      }

      const report = await computeOrgImpactReport(orgId);
      const show = !!report && report.eligible;
      return sendResponse(res, 200, {
        show,
        alreadyResponded: false,
        report: show ? report : null,
      });
    } catch (error) {
      console.error("[impact-survey/getMine] Error:", error);
      sendResponse(res, 500, null, "Error al obtener el reporte de impacto");
    }
  },

  /**
   * POST /api/impact-survey/respond
   * Guarda (upsert) la respuesta del admin. Body: { answers, reportSnapshot }.
   */
  respond: async (req, res) => {
    try {
      const orgId = req.organization?._id;
      if (!orgId) return sendResponse(res, 400, null, "Organización no resuelta");

      const { answers = {}, reportSnapshot = {} } = req.body || {};
      const doc = await ImpactSurveyResponse.findOneAndUpdate(
        { organizationId: orgId },
        {
          $set: {
            status: "answered",
            respondedByUserId: req.user?.userId || null,
            reportSnapshot: {
              daysActive: reportSnapshot.daysActive ?? null,
              totalAppointments: reportSnapshot.totalAppointments ?? null,
              onlineCount: reportSnapshot.onlineCount ?? null,
              onlinePct: reportSnapshot.onlinePct ?? null,
              noShowApplicable: !!reportSnapshot.noShowApplicable,
              noShowRate: reportSnapshot.noShowRate ?? null,
            },
            answers: {
              previousTool: answers.previousTool ?? null,
              previousToolOther: answers.previousToolOther ?? null,
              fewerNoShows: answers.fewerNoShows ?? null,
              biggestImprovement: Array.isArray(answers.biggestImprovement)
                ? answers.biggestImprovement
                : [],
              comment: answers.comment ?? null,
            },
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      sendResponse(res, 200, { id: String(doc._id) }, "¡Gracias por tu respuesta!");
    } catch (error) {
      console.error("[impact-survey/respond] Error:", error);
      sendResponse(res, 500, null, "Error al guardar la respuesta");
    }
  },

  /**
   * POST /api/impact-survey/snooze
   * Pospone el modal SNOOZE_DAYS días (vuelve a aparecer al vencer). No hay
   * descarte permanente. No pisa una respuesta ya existente.
   */
  snooze: async (req, res) => {
    try {
      const orgId = req.organization?._id;
      if (!orgId) return sendResponse(res, 400, null, "Organización no resuelta");

      // Si ya respondió, no hacemos nada (no degradar "answered").
      const existing = await ImpactSurveyResponse.findOne({ organizationId: orgId })
        .select("status")
        .lean();
      if (existing?.status === "answered") {
        return sendResponse(res, 200, { ok: true });
      }

      const snoozedUntil = new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000);
      await ImpactSurveyResponse.findOneAndUpdate(
        { organizationId: orgId },
        {
          $set: {
            status: "snoozed",
            snoozedUntil,
            respondedByUserId: req.user?.userId || null,
          },
        },
        { upsert: true, setDefaultsOnInsert: true }
      );
      sendResponse(res, 200, { ok: true, snoozedUntil });
    } catch (error) {
      console.error("[impact-survey/snooze] Error:", error);
      sendResponse(res, 500, null, "Error al posponer la encuesta");
    }
  },
};

export default impactSurveyController;
