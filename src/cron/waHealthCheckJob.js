// cron/waHealthCheckJob.js
//
// Detecta caídas silenciosas de sesiones WhatsApp (Baileys) y avisa a la
// organización (push + in-app + WhatsApp del número de AgenditApp,
// best-effort). Ver services/waHealthCheckService.js para la lógica y el
// anti-falso-positivo (solo avisa si sigue caída en dos corridas seguidas).
// Corre cada 15 minutos.

import cron from "node-cron";
import { checkWhatsappConnections } from "../services/waHealthCheckService.js";

const waHealthCheckJob = cron.schedule(
  "*/15 * * * *",
  async () => {
    try {
      const { checked, notified } = await checkWhatsappConnections();
      if (notified > 0) {
        console.log(
          `[waHealthCheck] ${checked} sesión(es) revisada(s), ${notified} aviso(s) de desconexión enviado(s).`
        );
      }
    } catch (err) {
      console.error("[waHealthCheck] Error general en el job:", err);
    }
  },
  { scheduled: false }
);

export default waHealthCheckJob;
