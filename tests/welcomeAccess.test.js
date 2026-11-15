// Pruebas de la bienvenida con el enlace de acceso al panel.
// Ejecutar: npm test  (node --test, sin base de datos ni red)
import { test } from "node:test";
import assert from "node:assert/strict";

import { panelLoginUrl, cuentaCreadaComponents } from "../src/utils/panelLinks.js";
import { isRecipientAllowed } from "../src/utils/devRecipientGuard.js";
import { buildWelcomeEmail } from "../src/utils/emailTemplates/welcomeEmail.js";
import { renderPlatformTemplate } from "../src/services/platformTemplateCatalog.js";

test("el enlace del panel lleva al login del subdominio, no a la página pública", () => {
  assert.equal(panelLoginUrl("mibarberia"), "https://mibarberia.agenditapp.com/login-admin");
});

test("cuenta_creada: 3 variables de body y el slug en el botón de URL dinámica", () => {
  const components = cuentaCreadaComponents({
    ownerName: "Laura\nPérez",
    businessName: "Barbería  El Estilo",
    email: "laura@gmail.com",
    slug: "barberiaelestilo",
  });
  const body = components.find((c) => c.type === "body");
  const button = components.find((c) => c.type === "button");

  assert.deepEqual(body.parameters.map((p) => p.text), ["Laura Pérez", "Barbería El Estilo", "laura@gmail.com"]);
  assert.equal(button.sub_type, "url");
  assert.equal(button.index, "0");
  assert.deepEqual(button.parameters, [{ type: "text", text: "barberiaelestilo" }]);
});

test("cuenta_creada: Meta no acepta parámetros vacíos", () => {
  const [body] = cuentaCreadaComponents({ ownerName: "  ", businessName: "X", email: "a@b.co", slug: "x" });
  assert.equal(body.parameters[0].text, "—");
});

test("el catálogo reconstruye cuenta_creada para el inbox de superadmin", () => {
  const text = renderPlatformTemplate("cuenta_creada", ["Laura", "Barbería El Estilo", "laura@gmail.com"]);
  assert.ok(text);
  assert.match(text, /Hola, Laura/);
  assert.match(text, /laura@gmail\.com/);
  assert.doesNotMatch(text, /\{\{\d\}\}/);
});

test("el correo de bienvenida trae el enlace del login, el correo de acceso y el negocio", () => {
  const mail = buildWelcomeEmail({
    ownerName: "Laura",
    businessName: "Barbería El Estilo",
    email: "laura@gmail.com",
    slug: "barberiaelestilo",
  });
  const url = "https://barberiaelestilo.agenditapp.com/login-admin";
  assert.match(mail.subject, /Barbería El Estilo/);
  for (const part of [mail.html, mail.text]) {
    assert.ok(part.includes(url), "falta el enlace del panel");
    assert.ok(part.includes("laura@gmail.com"), "falta el correo de acceso");
  }
});

test("el correo de bienvenida escapa el HTML del nombre del negocio", () => {
  const mail = buildWelcomeEmail({ businessName: "<script>x</script>", email: "a@b.co", slug: "abc" });
  assert.ok(!mail.html.includes("<script>"));
  assert.ok(mail.html.includes("&lt;script&gt;"));
});

test("en producción se le escribe a cualquier dueño", () => {
  assert.equal(isRecipientAllowed("cliente@gmail.com", { nodeEnv: "production", allowlist: "" }), true);
});

test("fuera de producción solo salen mensajes a la lista permitida", () => {
  const env = { nodeEnv: "development", allowlist: "Yo@Agenditapp.com, +57 300 123 4567" };
  assert.equal(isRecipientAllowed("yo@agenditapp.com", env), true);
  assert.equal(isRecipientAllowed("+573001234567", env), true);
  assert.equal(isRecipientAllowed("cliente@gmail.com", env), false);
  assert.equal(isRecipientAllowed("+573009999999", env), false);
  assert.equal(isRecipientAllowed("", env), false);
});

test("fuera de producción, sin lista permitida, no sale nada", () => {
  assert.equal(isRecipientAllowed("yo@agenditapp.com", { nodeEnv: "development", allowlist: "" }), false);
  assert.equal(isRecipientAllowed("+573001234567", { nodeEnv: undefined, allowlist: "" }), false);
});

test("la bienvenida sale del número Oficina, que es donde están aprobadas las plantillas de acceso", async () => {
  // Desde el número oficial Meta respondía 132001: cuenta_creada no existe en esa WABA.
  const { ACCESS_WA_LINE, WELCOME_WA_TEMPLATE } = await import("../src/utils/panelLinks.js");
  assert.equal(WELCOME_WA_TEMPLATE, "cuenta_creada");
  assert.equal(ACCESS_WA_LINE, "oficina");
});

test("el correo de bienvenida lleva la marca de AgenditApp, el enlace de reservas y la ayuda", () => {
  const mail = buildWelcomeEmail({
    ownerName: "Laura",
    businessName: "Barbería El Estilo",
    email: "laura@gmail.com",
    slug: "barberiaelestilo",
  });
  assert.ok(mail.html.includes('src="https://agenditapp.com/icono-full-blue.png"'), "falta el logo");
  assert.ok(mail.html.includes("#1D4ED8"), "falta el azul de la marca");
  assert.ok(mail.html.includes('href="https://barberiaelestilo.agenditapp.com"'), "falta el enlace de reservas");
  assert.ok(mail.html.includes("https://wa.me/573506674686"), "falta el WhatsApp de soporte");
  assert.match(mail.html, /display:none[^>]*>Guarda este correo/, "falta el texto de vista previa");
  assert.ok(mail.text.includes("https://barberiaelestilo.agenditapp.com\n"), "el texto plano no trae el enlace de reservas");
});
