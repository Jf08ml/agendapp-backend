import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMessage } from "../src/services/collection/clientReceiptNotifier.js";

test("el rechazo lleva el motivo del negocio", () => {
  const msg = buildMessage("rejected", { type: "reservation", receipt: { reviewNotes: "  El monto no coincide:\n faltan $5.000 " } }, "Galaxia", "Valentina Ríos");
  assert.match(msg, /^Hola Valentina/);
  assert.match(msg, /tu reserva no quedó confirmada\./);
  assert.match(msg, /\n\nMotivo: El monto no coincide: faltan \$5\.000\n\n/);
  assert.match(msg, /respóndenos por aquí\.$/);
});

test("sin motivo, el mensaje de siempre", () => {
  const msg = buildMessage("rejected", { type: "package", receipt: {} }, "Galaxia", "");
  assert.equal(msg, "Hola 👋 El equipo de *Galaxia* no pudo validar tu comprobante de pago. Si crees que es un error, respóndenos por aquí.");
});

test("motivo muy largo se recorta", () => {
  const msg = buildMessage("rejected", { type: "reservation", receipt: { reviewNotes: "x".repeat(500) } }, "G", "A");
  assert.ok(msg.includes("x".repeat(197) + "…"));
  assert.ok(!msg.includes("x".repeat(198)));
});
