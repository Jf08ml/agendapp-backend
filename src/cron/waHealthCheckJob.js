// cron/waHealthCheckJob.js
//
// Detecta caídas silenciosas de sesiones WhatsApp (Baileys) y avisa a la
// organización (push + in-app + WhatsApp del número de AgenditApp,
// best-effort). Ver services/waHealthCheckService.js para la lógica y el
// anti-falso-positivo (solo avisa si sigue caída en dos corridas seguidas).
// También revisa las orgs con Meta Cloud API: avisa cuando Meta bloquea sus
// envíos (health_status BLOCKED, p. ej. método de pago con error).
// Corre cada 15 minutos.

import cron from "node-cron";
import { checkWhatsappConnections, checkMetaHealth } from "../services/waHealthCheckService.js";

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

    try {
      const { checked, notified } = await checkMetaHealth();
      if (notified > 0) {
        console.log(
          `[waHealthCheck] ${checked} número(s) Meta revisado(s), ${notified} aviso(s) de bloqueo enviado(s).`
        );
      }
    } catch (err) {
      console.error("[waHealthCheck] Error general revisando Meta:", err);
    }
  },
  { scheduled: false }
);

export default waHealthCheckJob;
