/**
 * scripts/fixFollowUpUnconfirmedRetries.js
 *
 * Arreglo de datos del bug de seguimientos repetidos (2026-11-08, Oriana centro
 * de estética): con Baileys, el job esperaba como máximo 60 s a que terminara la
 * tanda, pero el microservicio deja 6–15 s entre mensajes, así que cualquier
 * tanda de más de ~4 mensajes quedaba "sin confirmar". El job lo contaba como
 * intento fallido y se lo volvía a mandar al cliente al día siguiente (hasta 3
 * veces), aunque el mensaje sí había llegado.
 *
 * Marca como enviadas (outcome "sent") las citas gatillo de orgs Baileys que
 * quedaron con followUpReminderFailCount > 0 y sin procesar: esos mensajes
 * salieron. Así la próxima corrida no les manda otro.
 *
 * Por defecto es un dry-run (solo muestra). Con --apply escribe.
 *
 * Uso:
 *   node -r @babel/register scripts/fixFollowUpUnconfirmedRetries.js            (todas las orgs Baileys)
 *   node -r @babel/register scripts/fixFollowUpUnconfirmedRetries.js oriana     (solo ese slug)
 *   node -r @babel/register scripts/fixFollowUpUnconfirmedRetries.js oriana --apply
 */
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env.development",
});

async function run() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const slug = args.find((a) => !a.startsWith("--"));

  await mongoose.connect(process.env.DB_URI);
  const db = mongoose.connection.db;

  const orgFilter = { waConnectionType: { $ne: "meta" }, clientIdWhatsapp: { $nin: [null, ""] } };
  if (slug) orgFilter.slug = slug;
  const orgs = await db.collection("organizations").find(orgFilter).project({ name: 1, slug: 1 }).toArray();
  const orgById = new Map(orgs.map((o) => [String(o._id), o]));

  const appts = await db
    .collection("appointments")
    .find({
      organizationId: { $in: orgs.map((o) => o._id) },
      followUpReminderSent: { $ne: true },
      followUpReminderFailCount: { $gt: 0 },
    })
    .project({ organizationId: 1, service: 1, client: 1, startDate: 1, followUpReminderFailCount: 1 })
    .toArray();

  const services = await db
    .collection("services")
    .find({ _id: { $in: [...new Set(appts.map((a) => String(a.service)))].map((id) => new mongoose.Types.ObjectId(id)) } })
    .project({ name: 1, followUpServiceId: 1, followUpDays: 1 })
    .toArray();
  const serviceById = new Map(services.map((s) => [String(s._id), s]));

  const perOrg = new Map();
  for (const a of appts) {
    const key = String(a.organizationId);
    perOrg.set(key, (perOrg.get(key) || 0) + 1);
  }
  for (const [orgId, n] of perOrg) {
    const o = orgById.get(orgId);
    console.log(`${o?.name} (${o?.slug}): ${n} cita(s) con reintento pendiente`);
  }
  console.log(`Total: ${appts.length}`);

  if (!apply) {
    console.log("\nDry-run: no se escribió nada. Agrega --apply para marcarlas como enviadas.");
    await mongoose.disconnect();
    return;
  }

  let modified = 0;
  const now = new Date();
  for (const a of appts) {
    const s = serviceById.get(String(a.service));
    const r = await db.collection("appointments").updateOne(
      { _id: a._id, followUpReminderSent: { $ne: true } },
      {
        $set: {
          followUpReminderSent: true,
          followUpReminderOutcome: "sent",
          followUpReminderProcessedAt: now,
          followUpReminderTargetServiceId: s?.followUpServiceId ?? null,
          followUpReminderTargetDays: s?.followUpDays ?? null,
        },
      }
    );
    modified += r.modifiedCount;
  }
  console.log(`\n✓ Marcadas como enviadas: ${modified}`);
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
