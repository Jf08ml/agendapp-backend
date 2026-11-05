// scripts/diagnoseInvalidDocs.js
// Solo lectura: lista organizaciones y servicios cuyo documento actual no pasa la
// validación de Mongoose (cualquier .save() sobre ellos fallaría).
// Uso: node scripts/diagnoseInvalidDocs.js
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV || "development"}` });

import mongoose from "mongoose";
import dbConnection from "../src/config/db.js";
import Organization from "../src/models/organizationModel.js";
import Service from "../src/models/serviceModel.js";

const report = async (Model, label, extra) => {
  const bad = [];
  for await (const doc of Model.find().cursor()) {
    const err = doc.validateSync();
    if (err) bad.push({ id: String(doc._id), info: extra(doc), errors: Object.values(err.errors).map((e) => `${e.path}: ${e.message}`) });
  }
  console.log(`\n=== ${label}: ${bad.length} inválidos ===`);
  for (const b of bad) console.log(b.id, b.info, "\n   ", b.errors.join("\n    "));
};

await dbConnection();
await report(Organization, "Organizaciones", (o) => o.name);
await report(Service, "Servicios", (s) => `${s.name} (org ${s.organizationId})`);
await mongoose.disconnect();
