import { test } from "node:test";
import assert from "node:assert/strict";
import { fitsConcurrency, holdAsAppointment, isHoldActive } from "../src/services/paymentHoldService.js";

const now = new Date("2026-11-24T15:00:00Z");

test("un pedido aparta el cupo mientras no vence o está en revisión", () => {
  assert.equal(isHoldActive({ status: "created", expiresAt: "2026-11-24T15:10:00Z" }, now), true);
  assert.equal(isHoldActive({ status: "pending", expiresAt: "2026-11-24T14:59:00Z" }, now), false);
  assert.equal(isHoldActive({ status: "pending" }, now), false);
  assert.equal(isHoldActive({ status: "in_review", expiresAt: "2026-11-24T10:00:00Z" }, now), true);
  assert.equal(isHoldActive({ status: "paid", expiresAt: "2026-11-24T16:00:00Z" }, now), false);
  assert.equal(isHoldActive({ status: "expired", expiresAt: "2026-11-24T16:00:00Z" }, now), false);
  assert.equal(isHoldActive(null, now), false);
});

test("la reserva apartada toma la forma de una cita", () => {
  const a = holdAsAppointment({
    _id: "r1",
    startDate: "2026-11-24T20:00:00Z",
    serviceId: { _id: "s1", duration: 45 },
    employeeId: "e1",
  });
  assert.deepEqual(a, {
    _id: "r1",
    startDate: new Date("2026-11-24T20:00:00Z"),
    endDate: new Date("2026-11-24T20:45:00Z"),
    employee: "e1",
    service: "s1",
    status: "held",
  });
});

test("cupos simultáneos: otro servicio ocupa, el mismo cuenta contra el límite", () => {
  assert.equal(fitsConcurrency([], "s1", 1), true);
  assert.equal(fitsConcurrency([{ service: "s1" }], "s1", 1), false);
  assert.equal(fitsConcurrency([{ service: "s1" }], "s1", 2), true);
  assert.equal(fitsConcurrency([{ service: { _id: "s2" } }], "s1", 3), false);
});
