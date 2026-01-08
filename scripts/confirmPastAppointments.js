import dbConnection from "../src/config/db.js";
import appointmentModel from "../src/models/appointmentModel.js";
import organizationModel from "../src/models/organizationModel.js";
import clientService from "../src/services/clientService.js";

async function confirmPastAppointments() {
  console.log("Starting past appointments confirmation run");

  try {
    await dbConnection();

    const now = new Date();
    const filter = {
      status: "pending",
      startDate: { $lt: now },
    };

    const totalPending = await appointmentModel.countDocuments(filter);
    console.log(`Pending appointments before now: ${totalPending}`);

    if (totalPending === 0) {
      console.log("No pending appointments found before now. Exiting.");
      process.exit(0);
    }

    const stats = new Map();
    const BATCH = 500;
    let lastId = null;

    while (true) {
      const batchFilter = lastId
        ? { ...filter, _id: { $gt: lastId } }
        : filter;

      const batch = await appointmentModel
        .find(batchFilter)
        .sort({ _id: 1 })
        .limit(BATCH);

      if (batch.length === 0) break;

      for (const appointment of batch) {
        const orgId = String(appointment.organizationId);
        const current =
          stats.get(orgId) || {
            orgId,
            processed: 0,
            confirmed: 0,
            errors: 0,
            sampleIds: [],
          };

        current.processed += 1;

        try {
          appointment.status = "confirmed";
          await appointment.save();

          if (appointment.client) {
            try {
              await clientService.registerService(appointment.client);
            } catch (clientErr) {
              console.warn(
                `Warning registering service for client ${appointment.client}: ${clientErr.message}`
              );
            }
          }

          current.confirmed += 1;
          if (current.sampleIds.length < 3) {
            current.sampleIds.push(appointment._id.toString());
          }
        } catch (err) {
          current.errors += 1;
          console.error(
            `Error confirming appointment ${appointment._id} (org ${orgId}): ${err.message}`
          );
        }

        stats.set(orgId, current);
        lastId = appointment._id;
      }
    }

    const orgIds = [...stats.keys()];
    const orgDocs = await organizationModel
      .find({ _id: { $in: orgIds } }, { name: 1, timezone: 1 })
      .lean();
    const orgNameById = Object.fromEntries(
      orgDocs.map((org) => [String(org._id), org.name])
    );

    console.log("\nConfirmation summary by organization:");
    for (const [, summary] of stats) {
      const orgName = orgNameById[summary.orgId] || "<unknown org>";
      console.log(
        `- ${orgName} (${summary.orgId}): confirmed ${summary.confirmed} / processed ${summary.processed}`
      );
      if (summary.sampleIds.length) {
        console.log(`  sample ids: ${summary.sampleIds.join(", ")}`);
      }
      if (summary.errors > 0) {
        console.log(`  errors: ${summary.errors}`);
      }
    }

    const totalConfirmed = [...stats.values()].reduce(
      (acc, item) => acc + item.confirmed,
      0
    );
    const totalErrors = [...stats.values()].reduce(
      (acc, item) => acc + item.errors,
      0
    );

    console.log("\nGlobal totals:");
    console.log(`- Confirmed: ${totalConfirmed}`);
    console.log(`- Errors: ${totalErrors}`);
  } catch (error) {
    console.error("Unexpected error during confirmation run:", error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

confirmPastAppointments();
