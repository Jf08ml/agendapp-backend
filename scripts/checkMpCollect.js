// scripts/checkMpCollect.js
// Diagnóstico: muestra el estado de conexión de cobro (mpCollect) de las orgs,
// SIN exponer tokens. Ayuda a verificar con qué cuenta (userId) se conectó MP y
// si el token parece de prueba o de producción.
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV || "development"}` });

import axios from "axios";
import dbConnection from "../src/config/db.js";
import Organization from "../src/models/organizationModel.js";

const run = async () => {
  await dbConnection();

  const orgs = await Organization.find({ "mpCollect.connected": true })
    .select("name default_country mpCollect")
    .lean();

  if (orgs.length === 0) {
    console.log("No hay organizaciones con mpCollect.connected = true.");
  }

  for (const org of orgs) {
    const mp = org.mpCollect || {};
    const token = mp.accessToken || "";
    // Pista de entorno por prefijo del token (no exponemos el token completo).
    const tokenHint = token.startsWith("TEST-")
      ? "TEST- (prueba)"
      : token.startsWith("APP_USR-")
      ? "APP_USR- (producción/usuario)"
      : token
      ? `${token.slice(0, 8)}…`
      : "(sin token)";

    console.log("───────────────────────────────────────────────");
    console.log("Org:           ", org.name, `(${org._id})`);
    console.log("País:          ", org.default_country);
    console.log("MP userId:     ", mp.userId);
    console.log("MP site:       ", mp.site);
    console.log("connectedAt:   ", mp.connectedAt);
    console.log("tokenExpiresAt:", mp.tokenExpiresAt);
    console.log("publicKey:     ", mp.publicKey);
    console.log("token prefix:  ", tokenHint);

    // Consultar /users/me para identificar la cuenta (test vs real).
    if (token) {
      try {
        const { data } = await axios.get("https://api.mercadopago.com/users/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const isTest =
          /^TEST/i.test(data.nickname || "") ||
          /@testuser\.com$/i.test(data.email || "");
        console.log("→ nickname:    ", data.nickname);
        console.log("→ email:       ", data.email);
        console.log("→ site_id:     ", data.site_id);
        console.log("→ ¿es test?:   ", isTest ? "SÍ (test user) ✅" : "NO parece test (¿cuenta real?) ⚠️");
      } catch (e) {
        console.log("→ /users/me error:", e.response?.status, e.response?.data?.message || e.message);
      }

      // Últimos pagos del vendedor (para ver el motivo real del fallo).
      try {
        const { data } = await axios.get(
          "https://api.mercadopago.com/v1/payments/search",
          {
            headers: { Authorization: `Bearer ${token}` },
            params: { sort: "date_created", criteria: "desc", limit: 5 },
          }
        );
        const results = data.results || [];
        console.log(`\n   Últimos ${results.length} pago(s) del vendedor:`);
        for (const p of results) {
          console.log(
            `   • id=${p.id} status=${p.status} detail=${p.status_detail} ` +
              `monto=${p.transaction_amount} ${p.currency_id} ref=${p.external_reference} fecha=${p.date_created}`
          );
        }
      } catch (e) {
        console.log("   payments/search error:", e.response?.status, e.response?.data?.message || e.message);
      }
    }
  }

  process.exit(0);
};

run().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
