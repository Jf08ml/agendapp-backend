import { test } from "node:test";
import assert from "node:assert/strict";
import { bulkOrganization, bulkServiceRow } from "../src/utils/bulkServices.js";

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const admin = { userType: "admin", userId: A };
const superadmin = { userType: "superadmin", adminId: "x", userId: "x" };

test("el negocio sale de la sesión, no del body", () => {
  assert.deepEqual(bulkOrganization({ user: admin, userOrgId: A, bodyOrgId: A }), { orgId: A });
  assert.deepEqual(bulkOrganization({ user: admin, userOrgId: A }), { orgId: A });
  assert.equal(bulkOrganization({ user: admin, userOrgId: A, bodyOrgId: B }).status, 403);
  assert.equal(bulkOrganization({ user: { userType: "employee", userId: "c" }, userOrgId: null, bodyOrgId: A }).status, 403);
  assert.deepEqual(bulkOrganization({ user: superadmin, bodyOrgId: B }), { orgId: B });
  assert.equal(bulkOrganization({ user: superadmin }).status, 400);
  // un token sin adminId no es superadmin
  assert.equal(bulkOrganization({ user: { userType: "superadmin" }, userOrgId: null, bodyOrgId: B }).status, 403);
});

test("validación de la fila (mismas reglas de antes)", () => {
  assert.match(bulkServiceRow({ name: "", price: 1, duration: 10 }).error, /obligatorios/);
  assert.match(bulkServiceRow({ name: "x", price: -1, duration: 10 }).error, /precio/);
  assert.match(bulkServiceRow({ name: "x", price: 1, duration: 0 }).error, /duración/);
  assert.match(bulkServiceRow({ name: "x", price: 1, duration: 10, maxConcurrentAppointments: 0 }).error, /concurrentes/);
  assert.match(bulkServiceRow({ _id: "123", name: "x", price: 1, duration: 10 }).error, /no es de uno de tus servicios/);
});

test("crear: valores por defecto y activo salvo «No»", () => {
  const r = bulkServiceRow({ _id: "(dejar vacío para crear nuevo)", name: " Corte ", price: "15000", duration: "30" });
  assert.equal(r.action, "create");
  assert.deepEqual(r.data, { name: "Corte", type: "", description: "", price: 15000, duration: 30, hidePrice: false, featured: false, maxConcurrentAppointments: 1, isActive: true });
  assert.equal(bulkServiceRow({ name: "x", price: 1, duration: 10, isActive: "No" }).data.isActive, false);
});

test("actualizar: solo los campos que vienen", () => {
  const r = bulkServiceRow({ _id: A, name: "Corte", price: 18000, duration: 30 });
  assert.equal(r.action, "update");
  assert.equal(r.id, A);
  assert.deepEqual(r.data, { name: "Corte", price: 18000, duration: 30 });

  const full = bulkServiceRow({ _id: A, name: "Corte", price: 1, duration: 10, type: "Barbería", description: "Clásico", hidePrice: "Sí", featured: false, maxConcurrentAppointments: 2, isActive: "No" });
  assert.deepEqual(full.data, { name: "Corte", price: 1, duration: 10, type: "Barbería", description: "Clásico", hidePrice: true, featured: false, maxConcurrentAppointments: 2, isActive: false });
});
