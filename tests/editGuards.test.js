import { test } from "node:test";
import assert from "node:assert/strict";
import { employeeEditScope, filterEmployeeUpdate, publicClientUpdate } from "../src/utils/editGuards.js";

const emp = { userType: "employee", userId: "e1" };

test("quién puede editar empleados y qué", () => {
  assert.equal(employeeEditScope({ user: { userType: "admin" } }), "all");
  assert.equal(employeeEditScope({ user: { userType: "superadmin", adminId: "x" } }), "all");
  assert.equal(employeeEditScope({ user: emp, permissions: ["employees:update"] }), "all");
  assert.equal(employeeEditScope({ user: emp, permissions: ["appointments:reorderemployees"] }), "order");
  assert.equal(employeeEditScope({ user: emp, permissions: ["appointments:view_own"] }), null);
  assert.equal(employeeEditScope({ user: null }), null);
});

test("reordenar solo cambia el orden; nadie cambia el negocio ni el rol", () => {
  const body = { order: 3, names: "X", password: "nueva", customPermissions: ["appointments:view_all"], organizationId: "otro", role: "admin" };
  assert.deepEqual(filterEmployeeUpdate(body, "order"), { order: 3 });
  const all = filterEmployeeUpdate(body, "all");
  assert.equal(all.organizationId, undefined);
  assert.equal(all.role, undefined);
  assert.equal(all.password, "nueva");
  assert.deepEqual(filterEmployeeUpdate(body, null), {});
});

test("edición pública del cliente: exige el mismo identificador", () => {
  const client = { phone_e164: "+573001234567", documentId: "123", email: "a@b.co" };
  const ok = publicClientUpdate({
    client,
    identifierField: "phone",
    body: { identifier: { field: "phone", value: "+57 300 123 4567" }, name: "Ana", phoneNumber: "+573009999999", organizationId: "otro" },
  });
  assert.deepEqual(ok, { updates: { name: "Ana" } }); // no cambia teléfono ni negocio
  assert.match(publicClientUpdate({ client, identifierField: "phone", body: { name: "Ana" } }).error, /verificar/);
  assert.match(
    publicClientUpdate({ client, identifierField: "phone", body: { identifier: { field: "phone", value: "+573000000000" }, name: "Ana" } }).error,
    /verificar/
  );
  assert.match(
    publicClientUpdate({ client, identifierField: "phone", body: { identifier: { field: "documentId", value: "123" } } }).error,
    /verificar/
  );
});

test("con documento como identificador sí puede actualizar el teléfono", () => {
  const client = { documentId: "ABC-1", phone_e164: "+573001234567" };
  const r = publicClientUpdate({
    client,
    identifierField: "documentId",
    body: { identifier: { field: "documentId", value: " abc-1 " }, phoneNumber: "+573009999999", documentId: "OTRO" },
  });
  assert.deepEqual(r, { updates: { phoneNumber: "+573009999999" } });
});
