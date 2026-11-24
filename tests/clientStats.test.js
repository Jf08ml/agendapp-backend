import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClientStats } from "../src/services/clientStatsService.js";

test("cifras por cliente y paquete activo", () => {
  const stats = buildClientStats(
    [
      { _id: "c1", lastVisit: new Date("2026-10-01T15:00:00Z"), visits: 6, totalSpent: 420000 },
      { _id: "c2", lastVisit: new Date("2026-11-20T15:00:00Z"), visits: 1, totalSpent: 35000.456 },
      { _id: null, visits: 3 },
    ],
    ["c2", "c3"]
  );
  assert.deepEqual(stats.c1, { lastVisit: "2026-10-01T15:00:00.000Z", visits: 6, totalSpent: 420000, activePackage: false });
  assert.equal(stats.c2.activePackage, true);
  assert.equal(stats.c2.totalSpent, 35000.46);
  assert.deepEqual(stats.c3, { lastVisit: null, visits: 0, totalSpent: 0, activePackage: true });
  assert.equal(Object.keys(stats).length, 3);
});
