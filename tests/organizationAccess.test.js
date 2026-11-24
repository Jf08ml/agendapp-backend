import { test } from "node:test";
import assert from "node:assert/strict";
import { organizationAccessDecision as decide } from "../src/middleware/organizationAccess.js";

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const admin = { userType: "admin", userId: A };
const employee = { userType: "employee", userId: "cccccccccccccccccccccccc" };
const superadmin = { userType: "superadmin", adminId: "x", userId: "x" };

test("superadmin puede todo", () => {
  assert.equal(decide({ method: "GET", path: "/", user: superadmin }), "allow");
  assert.equal(decide({ method: "DELETE", path: `/${B}`, user: superadmin }), "allow");
  assert.equal(decide({ method: "POST", path: `/${B}/wa/send`, user: superadmin }), "allow");
});

test("sin sesión o sin adminId de superadmin, nada", () => {
  assert.equal(decide({ method: "GET", path: `/${A}`, user: null }), "deny");
  assert.equal(decide({ method: "GET", path: "/", user: { userType: "superadmin" } }), "deny");
});

test("un negocio no lista ni crea negocios", () => {
  assert.equal(decide({ method: "GET", path: "/", user: admin, userOrgId: A }), "deny");
  assert.equal(decide({ method: "POST", path: "/", user: admin, userOrgId: A }), "deny");
});

test("su propio negocio sí; el de otro no", () => {
  assert.equal(decide({ method: "PUT", path: `/${A}`, user: admin, userOrgId: A }), "allow");
  assert.equal(decide({ method: "GET", path: `/${A}/mp/status`, user: admin, userOrgId: A }), "allow");
  assert.equal(decide({ method: "PUT", path: `/${B}`, user: admin, userOrgId: A }), "deny");
  assert.equal(decide({ method: "POST", path: `/${B}/wa/send`, user: admin, userOrgId: A }), "deny");
});

test("borrar el negocio entero es solo del superadmin", () => {
  assert.equal(decide({ method: "DELETE", path: `/${A}`, user: admin, userOrgId: A }), "deny");
  // Borrar algo dentro del negocio propio sigue permitido
  assert.equal(decide({ method: "DELETE", path: `/${A}/meta-disconnect`, user: admin, userOrgId: A }), "allow");
});

test("el empleado necesita saber su negocio y solo accede a ese", () => {
  assert.equal(decide({ method: "GET", path: `/${A}`, user: employee }), "need-org");
  assert.equal(decide({ method: "GET", path: `/${A}`, user: employee, userOrgId: A }), "allow");
  assert.equal(decide({ method: "GET", path: `/${B}`, user: employee, userOrgId: A }), "deny");
  assert.equal(decide({ method: "GET", path: `/${A}`, user: employee, userOrgId: null }), "deny");
});

test("rutas sin id de negocio se rechazan", () => {
  assert.equal(decide({ method: "GET", path: "/algo/raro", user: admin, userOrgId: A }), "deny");
});
