import Organization from "../models/organizationModel.js";

/**
 * Marca un hito del funnel de onboarding/activación una sola vez (idempotente).
 * Usa un update atómico que solo escribe si el hito aún no estaba seteado, así
 * el timestamp refleja la PRIMERA vez que ocurrió el evento.
 *
 * Es fire-and-forget: nunca debe romper el flujo principal (creación de cita,
 * conexión de WhatsApp, etc.). Cualquier error se loguea y se traga.
 *
 * @param {string} organizationId
 * @param {"setupCompletedAt"|"seededDemoAt"|"firstAppointmentAt"|"whatsappConnectedAt"|"firstAutoMessageAt"} milestone
 */
export async function markOnboardingMilestone(organizationId, milestone) {
  if (!organizationId || !milestone) return;
  const field = `onboardingMilestones.${milestone}`;
  try {
    await Organization.updateOne(
      { _id: organizationId, [field]: null }, // {$eq:null} matchea null o ausente
      { $set: { [field]: new Date() } }
    );
  } catch (err) {
    console.error(`[markOnboardingMilestone] ${milestone} org=${organizationId}:`, err?.message || err);
  }
}
