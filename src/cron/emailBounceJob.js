// cron/emailBounceJob.js
//
// Lee los avisos de no entrega del buzón hola@agenditapp.com y marca el correo
// del dueño como inválido (Organization.ownerEmailBounce). Ver
// services/emailBounceService.js. Corre cada hora, al minuto 20.

import cron from "node-cron";
import { checkEmailBounces } from "../services/emailBounceService.js";

const emailBounceJob = cron.schedule(
  "20 * * * *",
  async () => {
    try {
      const { scanned, bounces, marked, skipped } = await checkEmailBounces();
      if (skipped) return;
      if (bounces > 0) {
        console.log(`📭 [emailBounceJob] ${scanned} correo(s) revisado(s), ${bounces} rebote(s), ${marked} negocio(s) marcado(s).`);
      }
    } catch (err) {
      console.error("📭 [emailBounceJob] Error:", err?.message || err);
    }
  },
  { scheduled: false }
);

export default emailBounceJob;
