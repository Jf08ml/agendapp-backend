// scripts/fixMidnightPeriodEnds.js — membresías cuya fecha de vencimiento la puso el
// superadmin (DateInput → medianoche exacta: 00:00Z o 00:00 Bogotá = 05:00Z) pasan al
// FIN del día que el negocio ve en su zona horaria. Antes del fix de updateMembership,
// "vence el 13" cortaba el acceso al empezar el 13.
// Uso: node scripts/fixMidnightPeriodEnds.js            (dry-run)
//      node scripts/fixMidnightPeriodEnds.js --apply
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV || "development"}` });

import mongoose from "mongoose";
import moment from "moment-timezone";
import dbConnection from "../src/config/db.js";
import Membership from "../src/models/membershipModel.js";
import Organization from "../src/models/organizationModel.js";

const APPLY = process.argv.includes("--apply");

const isSuperadminMidnight = (d) =>
  d.getUTCMilliseconds() === 0 &&
  d.getUTCSeconds() === 0 &&
  d.getUTCMinutes() === 0 &&
  (d.getUTCHours() === 0 || d.getUTCHours() === 5);

const run = async () => {
  await dbConnection();
  const memberships = await Membership.find({
    status: { $in: ["active", "past_due"] },
    currentPeriodEnd: { $gte: new Date() },
  });

  let changed = 0;
  for (const m of memberships) {
    if (!isSuperadminMidnight(m.currentPeriodEnd)) continue;
    const org = await Organization.findById(m.organizationId).select("name timezone");
    const tz = org?.timezone || "America/Bogota";
    const newEnd = moment(m.currentPeriodEnd).tz(tz).endOf("day").toDate();

    console.log(
      `${(org?.name || m.organizationId).toString().slice(0, 30).padEnd(30)} ${tz.padEnd(20)} ` +
        `${m.currentPeriodEnd.toISOString()} → ${newEnd.toISOString()} ` +
        `(vence ${moment(newEnd).tz(tz).format("DD/MM/YYYY HH:mm")} hora local)`
    );

    if (APPLY) {
      await Membership.updateOne(
        { _id: m._id, currentPeriodEnd: m.currentPeriodEnd },
        { $set: { currentPeriodEnd: newEnd, nextPaymentDue: newEnd } }
      );
    }
    changed++;
  }

  console.log(`\n${changed} membresía(s) ${APPLY ? "actualizadas" : "a actualizar (dry-run, usa --apply)"}`);
  await mongoose.disconnect();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
