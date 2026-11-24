import { test } from "node:test";
import assert from "node:assert/strict";
import { superadminRefreshDecision } from "../src/utils/superadminRefresh.js";

const now = Date.parse("2026-11-24T12:00:00Z");
const inSec = (s) => Math.floor(now / 1000) + s;

test("superadmin vigente con adminId: se renueva", () => {
  assert.deepEqual(superadminRefreshDecision({ adminId: "a1", userType: "superadmin", exp: inSec(600) }, now), { ok: true });
});

test("sin adminId (token roto de un refresh anterior): no se renueva", () => {
  assert.equal(superadminRefreshDecision({ userType: "superadmin", exp: inSec(600) }, now).ok, false);
});

test("vencido: no se renueva", () => {
  assert.equal(superadminRefreshDecision({ adminId: "a1", userType: "superadmin", exp: inSec(-1) }, now).ok, false);
  assert.equal(superadminRefreshDecision({ adminId: "a1", userType: "superadmin" }, now).ok, false);
});
