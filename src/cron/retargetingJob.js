// cron/retargetingJob.js
import cron from "node-cron";
import {
  sendSetupNudges,
  sendFirstAppointmentNudges,
  sendWhatsappConnectNudges,
} from "../services/retargetingService.js";

/**
 * 🎯 Job de retargeting por WhatsApp para registros estancados en el funnel
 * de activación (setup sin terminar, sin primera cita, sin WhatsApp conectado).
 * Corre una vez al día. El aviso de trial por vencer va dentro de
 * membershipCheckJob (reusa su misma idempotencia de notificaciones).
 */
export async function runRetargeting() {
  console.log("🎯 [retargetingJob] Iniciando retargeting de activación", new Date().toISOString());

  try {
    const [setupSent, firstAppointmentSent, whatsappSent] = await Promise.all([
      sendSetupNudges(),
      sendFirstAppointmentNudges(),
      sendWhatsappConnectNudges(),
    ]);

    console.log(
      `🎯 [retargetingJob] Finalizado — activa_tu_cuenta: ${setupSent}, agenda_tu_primera_cita: ${firstAppointmentSent}, conecta_tu_whatsapp: ${whatsappSent}`
    );

    return { setupSent, firstAppointmentSent, whatsappSent };
  } catch (err) {
    console.error("🎯 [retargetingJob] Error general:", err?.message || err);
    return { setupSent: 0, firstAppointmentSent: 0, whatsappSent: 0 };
  }
}

const retargetingJob = cron.schedule(
  "0 11 * * *", // Todos los días a las 11:00 AM (hora Colombia)
  () => {
    runRetargeting();
  },
  {
    scheduled: false,
    timezone: "America/Bogota",
  }
);

export default retargetingJob;
