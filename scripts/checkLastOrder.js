// scripts/checkLastOrder.js — muestra el último Order y los campos de la
// preference enviada a MP (back_urls, expiración, monto) para diagnóstico.
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV || "development"}` });

import dbConnection from "../src/config/db.js";
import Order from "../src/models/orderModel.js";

const run = async () => {
  await dbConnection();
  const order = await Order.findOne().sort({ createdAt: -1 }).lean();
  if (!order) {
    console.log("No hay Orders.");
    process.exit(0);
  }
  console.log("Order _id:        ", order._id);
  console.log("status:           ", order.status);
  console.log("amount/currency:  ", order.amount, order.currency);
  console.log("externalReference:", order.externalReference);
  console.log("providerPrefId:   ", order.providerPrefId);
  console.log("checkoutUrl:      ", order.checkoutUrl);
  console.log("expiresAt:        ", order.expiresAt);

  const raw = order.raw || {};
  console.log("\n── preference (raw) ──");
  console.log("live_mode:        ", raw.live_mode, raw.live_mode ? "← PRODUCCIÓN ⚠️" : "← prueba ✅");
  console.log("sandbox_init_pt:  ", raw.sandbox_init_point);
  console.log("back_urls:        ", JSON.stringify(raw.back_urls));
  console.log("auto_return:      ", raw.auto_return);
  console.log("notification_url: ", raw.notification_url);
  console.log("expiration_date_to:", raw.expiration_date_to);
  console.log("marketplace_fee:  ", raw.marketplace_fee);
  console.log("items:            ", JSON.stringify(raw.items));
  console.log("collector_id:     ", raw.collector_id);
  process.exit(0);
};

run().catch((e) => { console.error(e); process.exit(1); });
