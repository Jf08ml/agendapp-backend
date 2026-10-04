/**
 * scripts/backfillPlatformTemplateText.js
 *
 * Reconstruye el body real (como lo vio el cliente) de los mensajes de retargeting
 * ya enviados, guardados en PlatformWaMessage con el preview genérico antiguo
 * ("[Plantilla: nombre] param1 · param2 · param3") — antes de que
 * platformTemplateCatalog.js existiera para renderizar el texto exacto de Meta.
 *
 * Los parámetros se recuperan parseando ese preview (siguen ahí, solo unidos con
 * " · " en vez de sustituidos en la plantilla) y se re-renderizan con
 * renderPlatformTemplate(). Solo toca documentos cuya plantilla esté catalogada
 * (activa_tu_cuenta, agenda_tu_primera_cita, conecta_tu_whatsapp, trial_por_vencer)
 * y cuyo body todavía tenga el formato antiguo — no vuelve a tocar mensajes ya
 * migrados ni mensajes que no sean de source: "retargeting".
 *
 * Uso: NODE_ENV=production node scripts/backfillPlatformTemplateText.js
 *      (o NODE_ENV=development)
 *      Agregar --dry-run para solo imprimir el antes/después sin escribir en Mongo.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import PlatformWaMessage from "../src/models/platformWaMessageModel.js";
import { renderPlatformTemplate } from "../src/services/platformTemplateCatalog.js";

dotenv.config({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env.development",
});

const OLD_PREVIEW_PREFIX = /^\[Plantilla: ([^\]]+)\] ?/;
const DRY_RUN = process.argv.includes("--dry-run");

async function run() {
  await mongoose.connect(process.env.DB_URI);
  console.log(`✓ Conectado a Mongo.${DRY_RUN ? " (dry-run — no se escribe nada)" : ""}`);

  const candidates = await PlatformWaMessage.find({
    source: "retargeting",
    body: { $regex: OLD_PREVIEW_PREFIX },
  }).select("templateName body");

  let updated = 0;
  let skipped = 0;

  for (const msg of candidates) {
    const match = msg.body.match(OLD_PREVIEW_PREFIX);
    const templateName = msg.templateName || match?.[1];
    const rest = msg.body.slice(match[0].length);
    const params = rest.length ? rest.split(" · ") : [];

    const rendered = templateName ? renderPlatformTemplate(templateName, params) : null;
    if (!rendered) {
      console.log(`  ⏭ ${msg._id} (${templateName || "?"}) — plantilla no catalogada, se deja igual.`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  → ${msg._id} (${templateName})`);
      console.log(`      antes:   ${msg.body}`);
      console.log(`      después: ${rendered}`);
    } else {
      await PlatformWaMessage.updateOne({ _id: msg._id }, { $set: { body: rendered } });
      console.log(`  ✓ ${msg._id} (${templateName}) → texto real reconstruido.`);
    }
    updated++;
  }

  console.log(
    `\n✓ Listo${DRY_RUN ? " (dry-run, nada escrito)" : ""}. ${updated} mensaje(s) ${DRY_RUN ? "a actualizar" : "actualizado(s)"}, ${skipped} omitido(s) de ${candidates.length} candidato(s).`
  );
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("✖ Error:", err);
  process.exit(1);
});
