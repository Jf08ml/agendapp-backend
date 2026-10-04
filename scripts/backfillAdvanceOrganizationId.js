// scripts/backfillAdvanceOrganizationId.js
// Rellena el campo `organizationId` (nuevo, ahora requerido) en los documentos
// Advance existentes que no lo tengan, derivándolo del `employee` asociado.
// Necesario porque:
//   1. El borrado en cascada de una organización (adminController.js) hace
//      Advances.deleteMany({ organizationId }) — sin este campo, nunca borraba nada.
//   2. Las rutas /advances ahora acotan todo por organizationId (fix de IDOR).
// Idempotente: solo toca documentos sin organizationId, se puede correr varias veces.
// Uso: node scripts/backfillAdvanceOrganizationId.js  (NODE_ENV=production para prod)
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV || "development"}` });

import dbConnection from "../src/config/db.js";
import Advance from "../src/models/advancesModel.js";
import Employee from "../src/models/employeeModel.js";

async function run() {
  try {
    await dbConnection();

    const pending = await Advance.find({
      $or: [{ organizationId: { $exists: false } }, { organizationId: null }],
    });
    console.log(`Avances/ingresos sin organizationId: ${pending.length}`);

    if (pending.length === 0) {
      console.log("✅ Nada que hacer.");
      process.exit(0);
    }

    let updated = 0;
    let orphaned = 0;

    for (const advance of pending) {
      const employee = await Employee.findById(advance.employee);
      if (!employee) {
        console.log(`  ⚠️ Advance ${advance._id}: su employee (${advance.employee}) ya no existe. Se deja sin tocar.`);
        orphaned++;
        continue;
      }

      await Advance.updateOne(
        { _id: advance._id },
        { $set: { organizationId: employee.organizationId } }
      );
      updated++;
    }

    console.log(`\n✅ Completado: ${updated} actualizados, ${orphaned} huérfanos (sin employee válido, revisar manualmente)`);
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Error en el backfill de Advance.organizationId:", err);
    process.exit(1);
  }
}

run();
