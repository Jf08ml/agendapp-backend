/**
 * scripts/encryptMpTokens.js
 *
 * Cifra en reposo los tokens de Mercado Pago (mpCollect.accessToken/refreshToken)
 * que aún estén en texto plano. Idempotente: omite los ya cifrados.
 *
 * Requiere TOKEN_ENC_KEY en el entorno. Ejecutar con babel-register:
 *   NODE_ENV=production node -e "require('@babel/register')({extensions:['.js']}); require('./scripts/encryptMpTokens.js')"
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import Organization from "../src/models/organizationModel.js";
import { encryptSecret, isEncrypted } from "../src/utils/cryptoTokens.js";

dotenv.config({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env.development",
});

async function run() {
  if (!process.env.TOKEN_ENC_KEY) {
    console.error("✖ TOKEN_ENC_KEY no está configurada. Aborta (no se cifraría nada).");
    process.exit(1);
  }

  await mongoose.connect(process.env.DB_URI);
  console.log("✓ Conectado a Mongo.");

  const orgs = await Organization.find({
    "mpCollect.connected": true,
  }).select("name mpCollect");

  let updated = 0;
  for (const org of orgs) {
    const mp = org.mpCollect || {};
    const accessPlain = mp.accessToken && !isEncrypted(mp.accessToken);
    const refreshPlain = mp.refreshToken && !isEncrypted(mp.refreshToken);
    if (!accessPlain && !refreshPlain) continue;

    if (accessPlain) org.mpCollect.accessToken = encryptSecret(mp.accessToken);
    if (refreshPlain) org.mpCollect.refreshToken = encryptSecret(mp.refreshToken);
    await org.save();
    updated++;
    console.log(`  ✓ Cifrado: ${org.name} (${org._id})`);
  }

  console.log(`\n✓ Listo. ${updated} organización(es) actualizada(s) de ${orgs.length} conectada(s).`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("✖ Error:", err);
  process.exit(1);
});
