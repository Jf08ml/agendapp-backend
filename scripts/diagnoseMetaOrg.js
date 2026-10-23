// scripts/diagnoseMetaOrg.js
// Diagnóstico Meta Cloud API de una organización (solo lectura, no envía mensajes):
// estado del número, salud del WABA y estado de las plantillas que usa la agenda.
// Uso: node scripts/diagnoseMetaOrg.js <slug-o-dominio>
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV || "development"}` });

import axios from "axios";
import mongoose from "mongoose";
import dbConnection from "../src/config/db.js";
import Organization from "../src/models/organizationModel.js";
import { listTemplates } from "../src/services/metaTemplateService.js";

const GRAPH_URL = "https://graph.facebook.com/v25.0";
const term = process.argv[2];
if (!term) {
  console.error("Uso: node scripts/diagnoseMetaOrg.js <slug-o-dominio>");
  process.exit(1);
}

const graphGet = async (path, fields, tokens) => {
  for (const [label, token] of tokens) {
    if (!token) continue;
    try {
      const res = await axios.get(`${GRAPH_URL}/${path}`, { params: { fields, access_token: token } });
      return { via: label, ...res.data };
    } catch (e) {
      console.log(`  [${label}] ${path} →`, e.response?.data?.error || e.message);
    }
  }
  return null;
};

const run = async () => {
  await dbConnection();
  const org = await Organization.findOne({
    $or: [{ slug: term }, { domains: { $regex: term, $options: "i" } }],
  }).lean();
  if (!org) return console.log("No se encontró la organización:", term);

  const tokens = [
    ["system_user", process.env.META_SYSTEM_USER_TOKEN],
    ["owner", org.metaAccessToken],
  ];

  console.log("\n=== Número ===");
  console.log(
    await graphGet(
      org.metaPhoneNumberId,
      "display_phone_number,verified_name,status,quality_rating,messaging_limit_tier,name_status,platform_type,code_verification_status,throughput",
      tokens
    )
  );

  console.log("\n=== WABA ===");
  console.log(
    await graphGet(org.metaWabaId, "name,account_review_status,health_status,ownership_type", tokens)
  );

  console.log("\n=== Plantillas ===");
  try {
    const templates = await listTemplates(org);
    for (const t of templates) console.log(`  ${t.name} [${t.language}] → ${t.status}`);
  } catch (e) {
    console.log("  Error listando plantillas:", e.response?.data?.error || e.message);
  }
};

run()
  .catch((e) => console.error(e))
  .finally(() => mongoose.disconnect());
