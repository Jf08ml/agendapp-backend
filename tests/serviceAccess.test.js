import { test } from "node:test";
import assert from "node:assert/strict";
import { canAccessService, editableServiceFields, listScope } from "../src/utils/serviceAccess.js";

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const admin = { userType: "admin", userId: A };
const employee = { userType: "employee", userId: "cccccccccccccccccccccccc" };
const superadmin = { userType: "superadmin", adminId: "x", userId: "x" };

test("solo servicios del propio negocio; superadmin todos", () => {
  assert.equal(canAccessService({ user: admin, userOrgId: A, serviceOrgId: A }), true);
  assert.equal(canAccessService({ user: admin, userOrgId: A, serviceOrgId: B }), false);
  assert.equal(canAccessService({ user: employee, userOrgId: B, serviceOrgId: B }), true);
  assert.equal(canAccessService({ user: employee, userOrgId: null, serviceOrgId: B }), false);
  assert.equal(canAccessService({ user: superadmin, serviceOrgId: B }), true);
  assert.equal(canAccessService({ user: { userType: "superadmin" }, userOrgId: null, serviceOrgId: B }), false);
  assert.equal(canAccessService({ user: null, serviceOrgId: A }), false);
});

test("listar: el propio negocio, o todos para superadmin", () => {
  assert.deepEqual(listScope({ user: admin, userOrgId: A }), { orgId: A });
  assert.deepEqual(listScope({ user: superadmin }), { all: true });
  assert.deepEqual(listScope({ user: employee, userOrgId: null }), { deny: true });
});

test("editar no cambia el negocio ni el id", () => {
  assert.deepEqual(editableServiceFields({ _id: A, organizationId: B, name: "Corte", price: 1 }), { name: "Corte", price: 1 });
});
