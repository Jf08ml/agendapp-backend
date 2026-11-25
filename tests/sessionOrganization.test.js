import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const { verifyToken } = await import("../src/middleware/authMiddleware.js");

const ORG = "aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbbbbbbbbbbbbbb";

async function run(payload, organization) {
  const token = jwt.sign(payload, process.env.JWT_SECRET);
  const req = { headers: { authorization: `Bearer ${token}` }, organization };
  let status = null;
  let passed = false;
  const res = { status(s) { status = s; return { json: () => {} }; } };
  await verifyToken(req, res, () => { passed = true; });
  return { status, passed };
}

test("sesión del mismo negocio que el dominio: pasa", async () => {
  assert.deepEqual(await run({ userId: ORG, userType: "admin" }, { _id: ORG }), { status: null, passed: true });
});

test("sesión de otro negocio: 403 aunque cambie el dominio", async () => {
  assert.deepEqual(await run({ userId: ORG, userType: "admin" }, { _id: OTHER }), { status: 403, passed: false });
});

test("sin negocio resuelto (rutas sin dominio) y superadmin: pasan", async () => {
  assert.equal((await run({ userId: ORG, userType: "admin" }, undefined)).passed, true);
  assert.equal((await run({ adminId: "x", userType: "superadmin" }, { _id: OTHER })).passed, true);
});
