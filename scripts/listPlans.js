// scripts/listPlans.js
import { config } from "dotenv";
import dbConnection from "../src/config/db.js";
import Plan from "../src/models/planModel.js";
import Membership from "../src/models/membershipModel.js";
import Organization from "../src/models/organizationModel.js";

// Load environment file relative to this script directory
import { fileURLToPath } from "url";
import path from "path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(__dirname, `../.env.${process.env.NODE_ENV || "development"}`);
config({ path: envFile });

async function listPlans() {
  try {
    await dbConnection();
    console.log("\n✓ Conectado a la base de datos");

    const plans = await Plan.find({ isActive: true }).lean();
    if (plans.length === 0) {
      console.log("\nNo hay planes activos configurados.");
      process.exit(0);
    }

    console.log("\n📦 Planes activos disponibles:");
    for (const plan of plans) {
      console.log(`\n- ${plan.displayName} [${plan.slug}]`);
      const usd = plan.prices?.USD ?? null;
      const cop = plan.prices?.COP ?? plan.price ?? null;
      if (usd !== null || cop !== null) {
        const parts = [];
        if (usd !== null) parts.push(`$${usd.toLocaleString()} USD / ${plan.billingCycle}`);
        if (cop !== null) parts.push(`$${cop.toLocaleString()} COP / ${plan.billingCycle}`);
        console.log(`  Precio: ${parts.join(" | ")}`);
      } else {
        console.log(`  Precio: $${plan.price?.toLocaleString()} / ${plan.billingCycle}`);
      }
      console.log(`  Dominio: ${plan.domainType === "custom_domain" ? "Dominio propio" : "Subdominio"}`);
      const limits = plan.limits || {};
      console.log(
        `  Límites: empleados=${limits.maxEmployees ?? "ilimitado"}, servicios=${limits.maxServices ?? "ilimitado"}, citas/mes=${limits.maxAppointmentsPerMonth ?? "ilimitado"}, almacenamiento=${limits.maxStorageGB ?? "N/A"}GB`
      );
      const extras = [];
      if (limits.autoReminders) extras.push("Recordatorios automáticos");
      if (limits.autoConfirmations) extras.push("Confirmaciones automáticas");
      if (extras.length) console.log(`  Automatizaciones: ${extras.join(", ")}`);
    }

    // Also summarize current active memberships per plan
    const activeStatuses = ["active", "trial", "grace_period"]; 
    const memberships = await Membership.find({ status: { $in: activeStatuses } })
      .populate("planId organizationId")
      .lean();

    if (memberships.length === 0) {
      console.log("\n📊 No hay membresías activas actualmente.");
    } else {
      console.log("\n📊 Resumen de membresías activas por plan:");
      const byPlan = new Map();
      for (const m of memberships) {
        const key = m.planId?._id?.toString() || "unknown";
        const arr = byPlan.get(key) || [];
        arr.push(m);
        byPlan.set(key, arr);
      }

      for (const plan of plans) {
        const arr = byPlan.get(plan._id.toString()) || [];
        console.log(`- ${plan.displayName}: ${arr.length} membresía(s)`);
      }

      // Show a brief list of organizations (up to 5) per plan
      for (const plan of plans) {
        const arr = byPlan.get(plan._id.toString()) || [];
        if (arr.length > 0) {
          const names = arr
            .slice(0, 5)
            .map((m) => m.organizationId?.name || m.organizationId?._id?.toString() || "(sin nombre)");
          console.log(`  Ejemplos (${Math.min(5, arr.length)}): ${names.join(", ")}`);
        }
      }
    }

    console.log("\n✅ Listado completado.\n");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Error listando planes:", err.message);
    process.exit(1);
  }
}

listPlans();
