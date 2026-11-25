import { test } from "node:test";
import assert from "node:assert/strict";
import { permissionDecision as decide, PERMS } from "../src/middleware/requirePermission.js";
import { ownOrganizationDecision as own } from "../src/middleware/organizationAccess.js";

const ORG = "aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbbbbbbbbbbbbbb";
const employee = { userType: "employee", userId: "e1" };
const professional = { organizationId: ORG, role: { permissions: ["appointments:view_own", "employeeInformation:read"] }, customPermissions: [] };
const manager = { organizationId: ORG, role: { permissions: ["cashManagement:read", "employees:read"] }, customPermissions: [] };

test("Caja: gastos solo con permiso de caja", () => {
  assert.equal(decide({ user: employee, anyOf: PERMS.cash, employee: professional, organizationId: ORG }), "deny");
  assert.equal(decide({ user: employee, anyOf: PERMS.cash, employee: manager, organizationId: ORG }), "allow");
  assert.equal(decide({ user: { userType: "admin", userId: ORG }, anyOf: PERMS.cash }), "allow");
});

test("anticipos: un profesional no los registra ni ve los de otros", () => {
  assert.equal(decide({ user: employee, anyOf: PERMS.advancesWrite, employee: professional, organizationId: ORG }), "deny");
  assert.equal(decide({ user: employee, anyOf: PERMS.advancesReadOthers, employee: professional, organizationId: ORG }), "deny");
  assert.equal(decide({ user: employee, anyOf: PERMS.advancesWrite, employee: manager, organizationId: ORG }), "allow");
});

test("el negocio del dominio debe ser el de la sesión", () => {
  assert.equal(own({ user: { userType: "admin", userId: ORG }, organizationId: ORG, userOrgId: ORG }), "allow");
  assert.equal(own({ user: { userType: "admin", userId: ORG }, organizationId: OTHER, userOrgId: ORG }), "deny");
  assert.equal(own({ user: employee, organizationId: ORG }), "need-org");
  assert.equal(own({ user: employee, organizationId: ORG, userOrgId: null }), "deny");
  assert.equal(own({ user: { userType: "superadmin", adminId: "x" }, organizationId: OTHER }), "allow");
  assert.equal(own({ user: { userType: "admin", userId: ORG }, organizationId: undefined, userOrgId: ORG }), "deny");
  assert.equal(own({ user: null, organizationId: ORG }), "deny");
});
