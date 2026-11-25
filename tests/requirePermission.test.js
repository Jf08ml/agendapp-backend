import { test } from "node:test";
import assert from "node:assert/strict";
import { permissionDecision as decide, PERMS } from "../src/middleware/requirePermission.js";

const ORG = "aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbbbbbbbbbbbbbb";
const employee = { userType: "employee", userId: "e1" };
const professional = { organizationId: ORG, role: { permissions: ["appointments:view_own", "employeeInformation:read"] }, customPermissions: [] };
const adminRole = { organizationId: ORG, role: { permissions: ["clients:read", "clients:update", "businessInformation:read"] }, customPermissions: [] };

test("dueño y superadmin siempre pasan", () => {
  assert.equal(decide({ user: { userType: "admin", userId: ORG }, anyOf: ["clients:delete"] }), "allow");
  assert.equal(decide({ user: { userType: "superadmin", adminId: "x" }, anyOf: ["clients:delete"] }), "allow");
  assert.equal(decide({ user: { userType: "superadmin" }, anyOf: ["clients:delete"] }), "deny");
  assert.equal(decide({ user: null, anyOf: ["x"] }), "deny");
});

test("empleado: necesita el permiso (rol o individual) y ser del negocio", () => {
  assert.equal(decide({ user: employee, anyOf: ["clients:read"] }), "need-employee");
  assert.equal(decide({ user: employee, anyOf: PERMS.businessSettings, employee: professional, organizationId: ORG }), "deny");
  assert.equal(decide({ user: employee, anyOf: PERMS.businessSettings, employee: adminRole, organizationId: ORG }), "allow");
  assert.equal(decide({ user: employee, anyOf: PERMS.clientsUpdate, employee: adminRole, organizationId: OTHER }), "deny");
  assert.equal(decide({ user: employee, anyOf: ["clients:read"], employee: null }), "deny");
  assert.equal(decide({ user: employee, anyOf: ["clients:read"], employee: { ...adminRole, isActive: false } }), "deny");
});

test("la agenda sigue pudiendo buscar y crear clientes", () => {
  const scheduler = { ...professional, customPermissions: ["appointments:create"] };
  assert.equal(decide({ user: employee, anyOf: PERMS.clientsRead, employee: scheduler, organizationId: ORG }), "allow");
  assert.equal(decide({ user: employee, anyOf: PERMS.clientsCreate, employee: scheduler, organizationId: ORG }), "allow");
  assert.equal(decide({ user: employee, anyOf: PERMS.clientsUpdate, employee: scheduler, organizationId: ORG }), "deny");
  assert.equal(decide({ user: employee, anyOf: PERMS.clientsDelete, employee: scheduler, organizationId: ORG }), "deny");
  // profesional que solo ve su agenda: no ve la lista de clientes
  assert.equal(decide({ user: employee, anyOf: PERMS.clientsRead, employee: professional, organizationId: ORG }), "deny");
});
