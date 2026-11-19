// Pruebas de la recuperación de acceso y de la lectura de rebotes.
// Ejecutar: npm test  (node --test, sin base de datos ni red)
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  accessChannelsFor,
  codigoAccesoComponents,
  generateAccessCode,
  hashSecret,
  maskEmail,
  maskPhone,
  parseIdentifier,
  phoneMatchKey,
  sameHash,
} from "../src/utils/accountAccess.js";
import { looksLikeBounce, parseBounce } from "../src/utils/bounceParser.js";

test("enmascara correo y teléfono sin revelarlos completos", () => {
  assert.equal(maskEmail("juanperez@gmail.com"), "jua•••@gmail.com");
  assert.equal(maskEmail("ab@x.co"), "a•••@x.co");
  assert.equal(maskEmail("abcd@x.co"), "ab•••@x.co");
  assert.equal(maskPhone("+573008875187"), "+57 ••• ••• 5187");
  assert.equal(maskPhone("3008875187"), "••• ••• 5187");
});

test("identificador: correo, celular o nada", () => {
  assert.deepEqual(parseIdentifier(" Laura@Gmail.com "), { type: "email", value: "laura@gmail.com" });
  assert.deepEqual(parseIdentifier("+57 300 887 5187"), { type: "phone", value: "573008875187" });
  assert.equal(parseIdentifier("laura@"), null);
  assert.equal(parseIdentifier("12345"), null);
  assert.equal(parseIdentifier(""), null);
});

test("el teléfono se compara por los últimos 10 dígitos", () => {
  assert.equal(phoneMatchKey("+57 300-887-5187"), phoneMatchKey("3008875187"));
});

test("código de 6 dígitos y comparación por hash", () => {
  for (let i = 0; i < 50; i++) assert.match(generateAccessCode(), /^\d{6}$/);
  assert.ok(sameHash(hashSecret("123456"), hashSecret("123456")));
  assert.ok(!sameHash(hashSecret("123456"), hashSecret("123457")));
  assert.ok(!sameHash(undefined, hashSecret("1")));
});

test("codigo_acceso lleva el código en el body y en el botón de copiar", () => {
  const [body, button] = codigoAccesoComponents("042517");
  assert.deepEqual(body.parameters, [{ type: "text", text: "042517" }]);
  assert.equal(button.sub_type, "url");
  assert.deepEqual(button.parameters, [{ type: "text", text: "042517" }]);
});

test("el correo rebotado no se ofrece para recuperar el acceso", () => {
  const base = { email: "x@gmail.com", phoneNumber: "+573001112233" };
  assert.deepEqual(
    accessChannelsFor(base).map((c) => [c.channel, c.available]),
    [["email", true], ["whatsapp", true]]
  );
  const bounced = accessChannelsFor({ ...base, ownerEmailBounce: { address: "X@gmail.com" } });
  assert.equal(bounced[0].available, false);
  assert.equal(bounced[0].reason, "bounced");
  // Rebotó un correo anterior, no el actual: se ofrece.
  assert.equal(accessChannelsFor({ ...base, ownerEmailBounce: { address: "viejo@gmail.com" } })[0].available, true);
  assert.deepEqual(accessChannelsFor({ email: "x@gmail.com" }).map((c) => c.channel), ["email"]);
});

// Formato real de MailChannels (relay de Hostinger), con dirección ficticia.
const MAILCHANNELS_BOUNCE = [
  "From: MAILER-DAEMON@relay.mailchannels.net (Mail Delivery System)",
  "Subject: Undelivered Mail Returned to Sender",
  'Content-Type: multipart/report; report-type=delivery-status; boundary="B1"',
  "",
  "--B1",
  "Content-Type: text/plain; charset=us-ascii",
  "",
  "This is the mail system at host relay.mailchannels.net.",
  "",
  "<no.existe.123@gmail.com>: host gmail-smtp-in.l.google.com[74.125.142.27]",
  "    said: 550-5.1.1 The email account that you tried to reach does not exist.",
  "    Please try 550-5.1.1 double-checking the recipient's email address for",
  "    typos (in reply to RCPT TO command)",
  "",
  "--B1",
  "Content-Type: message/delivery-status",
  "",
  "Reporting-MTA: dns; relay.mailchannels.net",
  "",
  "Final-Recipient: rfc822; no.existe.123@gmail.com",
  "Original-Recipient: rfc822;no.existe.123@gmail.com",
  "Action: failed",
  "Status: 5.1.1",
  "Remote-MTA: dns; gmail-smtp-in.l.google.com",
  "Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does",
  "    not exist. Please try 550-5.1.1 double-checking the recipient's email",
  "",
  "--B1--",
].join("\r\n");

test("lee el destinatario y el motivo de un rebote DSN", () => {
  const [b, ...rest] = parseBounce(MAILCHANNELS_BOUNCE);
  assert.equal(rest.length, 0);
  assert.equal(b.recipient, "no.existe.123@gmail.com");
  assert.equal(b.status, "5.1.1");
  assert.equal(b.permanent, true);
  assert.match(b.diagnostic, /does not exist/);
  assert.doesNotMatch(b.diagnostic, /550/);
});

test("sin parte delivery-status usa el texto de Postfix", () => {
  const onlyText = MAILCHANNELS_BOUNCE.split("--B1\r\nContent-Type: message/delivery-status")[0];
  const [b] = parseBounce(onlyText);
  assert.equal(b.recipient, "no.existe.123@gmail.com");
  assert.equal(b.status, "5.1.1");
  assert.equal(b.permanent, true);
});

test("un aviso de demora (4.x.x) no cuenta como rebote", () => {
  const delayed = MAILCHANNELS_BOUNCE.replace("Action: failed", "Action: delayed").replace("Status: 5.1.1", "Status: 4.4.1");
  assert.deepEqual(parseBounce(delayed), []);
});

test("reconoce los avisos de no entrega por remitente o asunto", () => {
  assert.ok(looksLikeBounce({ from: "Mail Delivery System <MAILER-DAEMON@relay.mailchannels.net>", subject: "x" }));
  assert.ok(looksLikeBounce({ from: "a@b.com", subject: "Undelivered Mail Returned to Sender" }));
  assert.ok(!looksLikeBounce({ from: "noreply-dmarc-support@google.com", subject: "Report domain: agenditapp.com" }));
});

test("aviso_cuenta: 3 variables, como la plantilla aprobada", async () => {
  const { avisoCuentaComponents } = await import("../src/utils/accountAccess.js");
  const { renderPlatformTemplate } = await import("../src/services/platformTemplateCatalog.js");
  const [body] = avisoCuentaComponents({ ownerName: "María", businessName: "Salón Luna", when: "19 de noviembre a las 3:40 pm" });
  assert.equal(body.parameters.length, 3);
  assert.match(
    renderPlatformTemplate("aviso_cuenta", body.parameters.map((p) => p.text)),
    /^Hola María, .* cuenta de Salón Luna se actualizaron el 19 de noviembre a las 3:40 pm\./
  );
});

test("el enlace del correo abre la recuperación en el dominio del negocio", async () => {
  const { accessPageUrl } = await import("../src/utils/accountAccess.js");
  const prod = { nodeEnv: "production" };
  assert.equal(accessPageUrl({ slug: "mibarberia" }, "c=1&t=2", prod), "https://mibarberia.agenditapp.com/recuperar-acceso?c=1&t=2");
  assert.equal(accessPageUrl({ domains: ["www.minegocio.com"] }, "c=1&t=2", prod), "https://www.minegocio.com/recuperar-acceso?c=1&t=2");
  assert.equal(accessPageUrl({}, "c=1&t=2", prod), "https://app.agenditapp.com/recuperar-acceso?c=1&t=2");
  assert.equal(
    accessPageUrl({ slug: "mibarberia" }, "c=1&t=2", { nodeEnv: "development", frontendBaseUrl: "http://localhost:5173/" }),
    "http://localhost:5173/recuperar-acceso?c=1&t=2&slug=mibarberia"
  );
});
