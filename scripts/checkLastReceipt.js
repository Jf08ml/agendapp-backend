// scripts/checkLastReceipt.js — muestra el último Order de tipo comprobante
// (provider "receipt") con los datos que extrajo la IA y por qué no se auto-aprobó.
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV || "development"}` });

import dbConnection from "../src/config/db.js";
import Order from "../src/models/orderModel.js";
import Organization from "../src/models/organizationModel.js";
import { evaluateReceipt } from "../src/services/collection/receiptValidationService.js";

const run = async () => {
  await dbConnection();
  const order = await Order.findOne({ provider: "receipt", "receipt.imageUrl": { $exists: true } })
    .sort({ createdAt: -1 })
    .lean();
  if (!order) {
    console.log("No hay Orders de comprobante.");
    process.exit(0);
  }
  console.log("Order _id:        ", String(order._id));
  console.log("type/status:      ", order.type, "/", order.status);
  console.log("amount/currency:  ", order.amount, order.currency);

  const r = order.receipt || {};
  console.log("\n── receipt ──");
  console.log("imageUrl:         ", r.imageUrl);
  console.log("aiVerdict:        ", r.aiVerdict);
  console.log("aiConfidence:     ", r.aiConfidence);
  console.log("reviewStatus:     ", r.reviewStatus);
  console.log("aiNotes (razón):  ", r.aiNotes);
  console.log("\n── extracted ──");
  console.log(JSON.stringify(r.extracted, null, 2));

  const org = await Organization.findById(order.organizationId)
    .select("paymentMethods currency")
    .lean();
  console.log("\n── paymentMethods de la org (cuentas esperadas) ──");
  console.log(JSON.stringify(org?.paymentMethods, null, 2));

  // Re-evaluar con la lógica ACTUAL (dry-run) para confirmar si ahora auto-aprobaría.
  const decision = evaluateReceipt({
    extracted: {
      isReceipt: true,
      amount: r.extracted?.amount,
      reference: r.extracted?.reference,
      destinationAccount: r.extracted?.destinationAccount,
      confidence: r.aiConfidence,
    },
    expectedAmount: order.amount,
    currency: order.currency,
    paymentMethods: org?.paymentMethods,
    isDuplicateReference: false,
  });
  console.log("\n── RE-EVALUACIÓN con la lógica actual ──");
  console.log("autoApprove:      ", decision.autoApprove);
  console.log("verdict:          ", decision.verdict);
  console.log("reasons:          ", JSON.stringify(decision.reasons));
  process.exit(0);
};

run().catch((e) => { console.error(e); process.exit(1); });
