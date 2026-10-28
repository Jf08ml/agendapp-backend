import Organization from "../models/organizationModel.js";
import { emitBusinessActivated, emitFirstBooking } from "../services/oficinaEventsService.js";

// Hitos que son conversiones para AgenditApp Oficina IA.
const OFICINA_EVENTS = {
  firstAppointmentAt: emitBusinessActivated, // negocio activado = primera cita
  firstOnlineBookingAt: emitFirstBooking, // primera reserva de un cliente final
};

/**
 * Marca un hito del funnel de onboarding/activación una sola vez (idempotente).
 * Usa un update atómico que solo escribe si el hito aún no estaba seteado, así
 * el timestamp refleja la PRIMERA vez que ocurrió el evento.
 *
 * Es fire-and-forget: nunca debe romper el flujo principal (creación de cita,
 * conexión de WhatsApp, etc.). Cualquier error se loguea y se traga.
 *
 * @param {string} organizationId
 * La primera vez que se marca un hito que es conversión (ver OFICINA_EVENTS)
 * avisa a la Oficina; por eso conviene awaitear la llamada en serverless.
 *
 * @param {string} organizationId
 * @param {"setupCompletedAt"|"seededDemoAt"|"firstAppointmentAt"|"whatsappConnectedAt"|"firstAutoMessageAt"|"firstOnlineBookingAt"} milestone
 * @returns {Promise<boolean>} true si se marcó ahora por primera vez
 */
export async function markOnboardingMilestone(organizationId, milestone) {
  if (!organizationId || !milestone) return false;
  const field = `onboardingMilestones.${milestone}`;
  try {
    const now = new Date();
    const result = await Organization.updateOne(
      { _id: organizationId, [field]: null }, // {$eq:null} matchea null o ausente
      { $set: { [field]: now } }
    );
    const first = result.modifiedCount === 1;
    if (first && OFICINA_EVENTS[milestone]) {
      await OFICINA_EVENTS[milestone]({ organizationId, occurredAt: now });
    }
    return first;
  } catch (err) {
    console.error(`[markOnboardingMilestone] ${milestone} org=${organizationId}:`, err?.message || err);
    return false;
  }
}
