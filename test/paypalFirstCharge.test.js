// Ejecutar con: node --test test/paypalFirstCharge.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isRepeatedFirstPaypalCharge as repeated,
  PAYPAL_SUBSCRIPTION_ACTIVATED as ACTIVATED,
  PAYPAL_SALE_COMPLETED as SALE,
} from "../src/utils/paypalFirstCharge.js";

const paypal = (type, otherEventTypes) => repeated({ provider: "paypal", type, otherEventTypes });

test("el primer aviso del primer cobro se envía, llegue en el orden que llegue", () => {
  assert.equal(paypal(ACTIVATED, []), false);
  assert.equal(paypal(SALE, []), false);
});

test("el segundo aviso del primer cobro no se envía (caso real del 2026-11-05)", () => {
  assert.equal(paypal(SALE, [ACTIVATED]), true);
  assert.equal(paypal(ACTIVATED, [SALE]), true);
});

test("las renovaciones se envían siempre", () => {
  assert.equal(paypal(SALE, [ACTIVATED, SALE]), false);
  assert.equal(paypal(SALE, [SALE]), false);
  assert.equal(paypal(SALE, [ACTIVATED, SALE, SALE]), false);
});

test("otros proveedores y otros avisos no se tocan", () => {
  assert.equal(repeated({ provider: "manual", type: SALE, otherEventTypes: [ACTIVATED] }), false);
  assert.equal(paypal("PAYMENT.CAPTURE.COMPLETED", [ACTIVATED]), false);
});
