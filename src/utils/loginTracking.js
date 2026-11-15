import Organization from "../models/organizationModel.js";
import { markOnboardingMilestone } from "./onboardingMilestones.js";

/**
 * Registra que el dueño entró a su panel (intercambio del registro o login con
 * correo y contraseña): Organization.lastLoginAt y, la primera vez, el hito
 * onboardingMilestones.firstLoginAt. Sirve para distinguir "no pudo entrar" de
 * "entró y abandonó". No se llama en impersonación ni en logins de empleados.
 * Nunca lanza.
 */
export async function recordOwnerLogin(organizationId) {
  if (!organizationId) return;
  try {
    await Organization.updateOne({ _id: organizationId }, { $set: { lastLoginAt: new Date() } });
  } catch (err) {
    console.error(`[recordOwnerLogin] org=${organizationId}:`, err?.message || err);
  }
  await markOnboardingMilestone(organizationId, "firstLoginAt");
}
