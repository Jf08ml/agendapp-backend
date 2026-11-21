// Pruebas del pedido de reseña en Google tras la cita.
// Ejecutar: npm test  (node --test, sin base de datos ni red)
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REVIEW_COOLDOWN_DAYS,
  candidateWindow,
  googleReviewUrl,
  isValidPlaceId,
  isWithinSendingHours,
  selectReviewCandidates,
} from "../src/utils/googleReviews.js";

const PLACE = "ChIJN1t_tDeuEmsRUsoyG83frY4";

test("enlace de reseña a partir del Place ID", () => {
  assert.equal(googleReviewUrl(PLACE), `https://search.google.com/local/writereview?placeid=${PLACE}`);
  assert.equal(googleReviewUrl(""), null);
  assert.equal(googleReviewUrl("hola mundo"), null);
  assert.ok(isValidPlaceId(PLACE));
  assert.ok(!isValidPlaceId("abc"));
  assert.ok(!isValidPlaceId("ChIJ<script>alert(1)</script>"));
});

test("solo se envía entre 9:00 y 20:00 en la zona del negocio", () => {
  // 14:00 UTC = 9:00 en Bogotá (UTC-5)
  assert.ok(isWithinSendingHours(new Date("2026-11-19T14:00:00Z"), "America/Bogota"));
  assert.ok(!isWithinSendingHours(new Date("2026-11-19T13:59:00Z"), "America/Bogota"));
  // 01:00 UTC del día siguiente = 20:00 en Bogotá → ya no
  assert.ok(!isWithinSendingHours(new Date("2026-11-20T01:00:00Z"), "America/Bogota"));
  assert.ok(isWithinSendingHours(new Date("2026-11-20T00:59:00Z"), "America/Bogota"));
});

test("ventana: citas terminadas hace entre 2 y 48 horas", () => {
  const now = new Date("2026-11-19T18:00:00Z");
  const { from, to } = candidateWindow(now);
  assert.equal(to.toISOString(), "2026-11-19T16:00:00.000Z");
  assert.equal(from.toISOString(), "2026-11-17T18:00:00.000Z");
});

const now = new Date("2026-11-19T18:00:00Z");
const appt = (id, clientId, endIso, client = {}) => ({
  _id: id,
  endDate: new Date(endIso),
  client: clientId ? { _id: clientId, phone_e164: "+573001112233", ...client } : null,
});

test("un mensaje por cliente: la cita más reciente; las demás de la visita se descartan", () => {
  const { toSend, skipped } = selectReviewCandidates(
    [appt("a1", "c1", "2026-11-19T14:00:00Z"), appt("a2", "c1", "2026-11-19T15:00:00Z"), appt("b1", "c2", "2026-11-19T12:00:00Z")],
    { now }
  );
  assert.deepEqual(toSend.map((a) => a._id).sort(), ["a2", "b1"]);
  assert.deepEqual(skipped.map((s) => [s.appt._id, s.outcome]), [["a1", "skipped_same_visit"]]);
});

test("no se le vuelve a pedir a quien se le pidió hace poco", () => {
  const recent = new Date(now.getTime() - 10 * 24 * 3600 * 1000);
  const old = new Date(now.getTime() - (REVIEW_COOLDOWN_DAYS + 1) * 24 * 3600 * 1000);
  const { toSend, skipped } = selectReviewCandidates(
    [
      appt("a1", "c1", "2026-11-19T14:00:00Z", { googleReviewRequestedAt: recent }),
      appt("b1", "c2", "2026-11-19T14:00:00Z", { googleReviewRequestedAt: old }),
    ],
    { now }
  );
  assert.deepEqual(toSend.map((a) => a._id), ["b1"]);
  assert.deepEqual(skipped.map((s) => s.outcome), ["skipped_recent"]);
});

test("sin cliente o sin teléfono no se envía", () => {
  const { toSend, skipped } = selectReviewCandidates(
    [appt("a1", null, "2026-11-19T14:00:00Z"), appt("b1", "c2", "2026-11-19T14:00:00Z", { phone_e164: "" })],
    { now }
  );
  assert.equal(toSend.length, 0);
  assert.deepEqual(skipped.map((s) => s.outcome), ["skipped_no_phone", "skipped_no_phone"]);
});
