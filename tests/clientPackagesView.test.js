import { test } from "node:test";
import assert from "node:assert/strict";
import { isPackageVisible, packageState, packageView, sortPackages } from "../src/utils/clientPackagesView.js";

const now = new Date("2026-11-24T15:00:00Z");
const days = (n) => new Date(now.getTime() + n * 86400000);

test("qué paquetes se muestran", () => {
  assert.equal(isPackageVisible({ status: "active", expirationDate: days(10) }, now), true);
  assert.equal(isPackageVisible({ status: "cancelled", expirationDate: days(10) }, now), false);
  assert.equal(isPackageVisible({ status: "expired", expirationDate: days(-10) }, now), true);
  assert.equal(isPackageVisible({ status: "expired", expirationDate: days(-40) }, now), false);
  assert.equal(isPackageVisible({ status: "exhausted", expirationDate: days(90), updatedAt: days(-5) }, now), true);
  assert.equal(isPackageVisible({ status: "exhausted", expirationDate: days(90), updatedAt: days(-45) }, now), false);
  // activo pero ya pasó su fecha (el cron aún no lo marcó)
  assert.equal(isPackageVisible({ status: "active", expirationDate: days(-2) }, now), true);
});

test("estado en palabras", () => {
  assert.equal(packageState({ status: "active", expirationDate: days(30) }, now), "active");
  assert.equal(packageState({ status: "active", expirationDate: days(5) }, now), "expiring");
  assert.equal(packageState({ status: "active", expirationDate: days(-1) }, now), "expired");
  assert.equal(packageState({ status: "exhausted", expirationDate: days(30) }, now), "exhausted");
});

test("vista del paquete y orden", () => {
  const v = packageView(
    {
      _id: "p1",
      servicePackageId: { name: "Pestañas x8" },
      tierLabel: "x8",
      expirationDate: days(20),
      status: "active",
      services: [{ serviceId: { name: "Retoque" }, sessionsIncluded: 8, sessionsRemaining: 5 }],
      classes: [{ classId: { name: "Yoga" }, sessionsIncluded: 4, sessionsRemaining: 0 }],
    },
    now
  );
  assert.equal(v.name, "Pestañas x8");
  assert.deepEqual(v.items, [
    { name: "Retoque", remaining: 5, total: 8 },
    { name: "Yoga", remaining: 0, total: 4 },
  ]);
  const sorted = sortPackages([
    { state: "expired", expirationDate: days(-3) },
    { state: "active", expirationDate: days(40) },
    { state: "expiring", expirationDate: days(3) },
  ]);
  assert.deepEqual(sorted.map((p) => p.state), ["expiring", "active", "expired"]);
});
