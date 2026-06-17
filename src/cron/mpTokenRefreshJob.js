// cron/mpTokenRefreshJob.js
//
// Refresca los access_token de Mercado Pago de las organizaciones conectadas.
// El access_token de MP dura 180 días; lo refrescamos cuando faltan pocos días
// para que expire. Cada refresh devuelve un par NUEVO (access + refresh), que el
// servicio re-guarda. Corre 1×/día (3 AM).
//
// Si el refresh falla (refresh_token revocado/expirado), se loguea y la org
// deberá reconectar manualmente — el panel mostrará "desconectado" cuando el
// token expire.

import cron from "node-cron";
import Organization from "../models/organizationModel.js";
import { refreshToken } from "../services/collection/mpConnectService.js";

const REFRESH_BEFORE_DAYS = 15; // refrescar si expira dentro de N días

export const runMpTokenRefresh = async () => {
  const threshold = new Date(Date.now() + REFRESH_BEFORE_DAYS * 24 * 60 * 60 * 1000);

  const orgs = await Organization.find({
    "mpCollect.connected": true,
    "mpCollect.tokenExpiresAt": { $lte: threshold },
  })
    .select("_id")
    .lean();

  if (orgs.length === 0) {
    console.log("[MP Refresh] Sin tokens por refrescar.");
    return { refreshed: 0, errors: 0 };
  }

  console.log(`[MP Refresh] ${orgs.length} org(s) con token próximo a expirar.`);

  let refreshed = 0;
  let errors = 0;
  for (const org of orgs) {
    try {
      const ok = await refreshToken(org._id);
      if (ok) {
        refreshed++;
        console.log(`[MP Refresh] ✓ Token refrescado para org ${org._id}`);
      }
    } catch (err) {
      errors++;
      console.error(`[MP Refresh] Error org ${org._id}:`, err.response?.data || err.message);
    }
  }

  console.log(`[MP Refresh] Completado: ${refreshed} refrescados, ${errors} errores.`);
  return { refreshed, errors };
};

// Job: todos los días a las 3 AM
const mpTokenRefreshJob = cron.schedule(
  "0 3 * * *",
  async () => {
    try {
      await runMpTokenRefresh();
    } catch (err) {
      console.error("[MP Refresh] Error general en el job:", err);
    }
  },
  { scheduled: false }
);

export default mpTokenRefreshJob;
