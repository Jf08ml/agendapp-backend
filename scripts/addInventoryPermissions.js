// scripts/addInventoryPermissions.js
// Añade los permisos del módulo de inventario (inventory:read, inventory:manage,
// inventory:sell) a los roles de administrador existentes.
// Idempotente: usa $addToSet, se puede correr varias veces sin duplicar.
// Uso: node scripts/addInventoryPermissions.js  (NODE_ENV=production para prod)
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV || "development"}` });

import dbConnection from "../src/config/db.js";
import Role from "../src/models/roleModel.js";

const INVENTORY_PERMISSIONS = [
  "inventory:read",
  "inventory:manage",
  "inventory:sell",
];

// El rol admin es compartido por todas las orgs (ver registrationController.js:75,
// Role.findOne({ name: "admin" })). Se cubren variantes de nombre por si existen.
const ADMIN_ROLE_NAMES = ["admin", "Admin", "administrador", "Administrador"];

async function run() {
  try {
    await dbConnection();

    const adminRoles = await Role.find({ name: { $in: ADMIN_ROLE_NAMES } });
    console.log(`Roles de administrador encontrados: ${adminRoles.length}`);

    if (adminRoles.length === 0) {
      console.log("⚠️ No se encontró ningún rol de administrador. Nada que hacer.");
      process.exit(0);
    }

    let updated = 0;
    for (const role of adminRoles) {
      const missing = INVENTORY_PERMISSIONS.filter(
        (p) => !role.permissions.includes(p)
      );

      if (missing.length === 0) {
        console.log(`  ✅ "${role.name}" (${role._id}) ya tiene los permisos de inventario`);
        continue;
      }

      await Role.updateOne(
        { _id: role._id },
        { $addToSet: { permissions: { $each: INVENTORY_PERMISSIONS } } }
      );
      console.log(`  ✅ "${role.name}" (${role._id}) → añadidos: ${missing.join(", ")}`);
      updated++;
    }

    console.log(`\n✅ Completado: ${updated} rol(es) actualizados, ${adminRoles.length - updated} ya al día`);
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Error añadiendo permisos de inventario:", err);
    process.exit(1);
  }
}

run();
