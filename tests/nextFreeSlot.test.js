import { test } from "node:test";
import assert from "node:assert/strict";
import { earliestSlot, pickDefaultService } from "../src/services/nextFreeSlotService.js";

test("servicio por defecto: destacado y reservable en línea", () => {
  const s = (name, extra = {}) => ({ name, isActive: true, ...extra });
  assert.equal(pickDefaultService([s("A"), s("B", { featured: true })]).name, "B");
  assert.equal(pickDefaultService([s("A", { ctaMode: "whatsapp_quote", featured: true }), s("B")]).name, "B");
  assert.equal(pickDefaultService([s("A", { isActive: false }), s("B")]).name, "B");
  assert.equal(pickDefaultService([s("A", { isActive: false })]), null);
  assert.equal(pickDefaultService([]), null);
});

test("el horario libre más temprano entre profesionales", () => {
  const now = new Date("2026-11-24T15:00:00Z");
  const best = earliestSlot(
    [
      { employeeId: "e1", slots: [{ available: false, datetime: "2026-11-24T15:30:00Z" }, { available: true, datetime: "2026-11-24T17:00:00Z" }] },
      { employeeId: "e2", slots: [{ available: true, datetime: "2026-11-24T14:00:00Z" }, { available: true, datetime: "2026-11-24T16:00:00Z" }] },
    ],
    now
  );
  assert.deepEqual(best, { datetime: new Date("2026-11-24T16:00:00Z"), employeeId: "e2" });
  assert.equal(earliestSlot([{ employeeId: "e1", slots: [{ available: false, datetime: "2026-11-24T16:00:00Z" }] }], now), null);
});
