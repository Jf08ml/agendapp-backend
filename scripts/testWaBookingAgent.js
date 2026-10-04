// scripts/testWaBookingAgent.js
//
// Simula mensajes de WhatsApp entrantes de un cliente al número Meta de una org
// para probar el agente IA de reservas EN LOCAL, sin depender del webhook real de Meta.
//
// Qué hace:
//   1. Configura la org para el test (waConnectionType=meta, waBookingAgentEnabled=true,
//      metaPhoneNumberId de prueba si no tiene uno).
//   2. Abre una consola interactiva: lo que escribas se envía como si fuera un mensaje
//      de WhatsApp del cliente, firmado con HMAC igual que lo firma Meta.
//   3. Lee la respuesta del bot desde ChatLog (el envío real por Meta fallará en local
//      con un log — es esperado — pero la respuesta queda persistida).
//
// Uso:
//   1. En otra terminal: npm run dev  (backend corriendo en :5000)
//   2. node scripts/testWaBookingAgent.js <slug-o-id-de-org> [telefono-cliente]
//      ej: node scripts/testWaBookingAgent.js mibarberia
//      ej: node scripts/testWaBookingAgent.js 665f1a... 573009998877
//   3. Escribe mensajes como cliente. Comandos: /reset (nueva sesión simulando otro
//      teléfono), /salir para terminar.

import mongoose from "mongoose";
import dotenv from "dotenv";
import axios from "axios";
import readline from "readline";
import { createHmac } from "crypto";
import Organization from "../src/models/organizationModel.js";
import ChatLog from "../src/models/chatLogModel.js";

dotenv.config({ path: ".env.development" });

const API_URL = process.env.LOCAL_API_URL || "http://localhost:5000";
const WEBHOOK_URL = `${API_URL}/api/wa-agent/meta-incoming`;
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 90_000;

const orgArg = process.argv[2];
let clientPhone = (process.argv[3] || "573001112233").replace(/\D/g, "");

if (!orgArg) {
  console.error("Uso: node scripts/testWaBookingAgent.js <slug-o-id-de-org> [telefono-cliente]");
  process.exit(1);
}

if (!process.env.META_APP_SECRET) {
  console.error("❌ META_APP_SECRET no está en .env.development — necesario para firmar el payload.");
  process.exit(1);
}

function buildMetaPayload(org, text) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: org.metaWabaId || "TEST_WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: (org.metaPhone || "+570000000000").replace("+", ""),
                phone_number_id: org.metaPhoneNumberId,
              },
              contacts: [{ profile: { name: "Cliente Test" }, wa_id: clientPhone }],
              messages: [
                {
                  from: clientPhone,
                  id: `wamid.test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  text: { body: text },
                  type: "text",
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function sendAsClient(org, text) {
  const rawBody = JSON.stringify(buildMetaPayload(org, text));
  const signature =
    "sha256=" + createHmac("sha256", process.env.META_APP_SECRET).update(rawBody).digest("hex");

  await axios.post(WEBHOOK_URL, rawBody, {
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": signature,
    },
  });
}

async function getLatestLog(orgId) {
  return ChatLog.findOne({ organizationId: orgId, channel: "whatsapp" })
    .sort({ updatedAt: -1 })
    .lean();
}

async function waitForReply(orgId, prevCount) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const log = await getLatestLog(orgId);
    const msgs = log?.messages || [];
    if (msgs.length >= prevCount + 2 && msgs[msgs.length - 1].role === "assistant") {
      return { reply: msgs[msgs.length - 1].content, log };
    }
  }
  return { reply: null, log: null };
}

async function main() {
  await mongoose.connect(process.env.DB_URI);

  const org = mongoose.Types.ObjectId.isValid(orgArg)
    ? await Organization.findById(orgArg)
    : await Organization.findOne({ slug: orgArg });

  if (!org) {
    console.error(`❌ Organización no encontrada: ${orgArg}`);
    process.exit(1);
  }

  // ── Configurar la org para el test ──────────────────────────────────────────
  const changes = {};
  if (!org.metaPhoneNumberId) changes.metaPhoneNumberId = `test-phone-id-${org._id.toString().slice(-6)}`;
  if (org.waConnectionType !== "meta") changes.waConnectionType = "meta";
  if (!org.waBookingAgentEnabled) changes.waBookingAgentEnabled = true;
  if (Object.keys(changes).length) {
    await Organization.findByIdAndUpdate(org._id, changes);
    Object.assign(org, changes);
    console.log("⚙️  Org configurada para test:", changes);
  }

  console.log(`\n🏪 Org: ${org.name} (${org.slug || org._id})`);
  console.log(`📱 Cliente simulado: +${clientPhone}`);
  console.log(`🔗 Webhook: ${WEBHOOK_URL}`);
  console.log(`\n⚠️  El envío real por Meta fallará en local (log en el backend) — es esperado.`);
  console.log(`   La respuesta del bot se lee desde ChatLog.\n`);
  console.log(`Escribe como cliente. Comandos: /reset (otro teléfono = nueva sesión), /salir\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  for (;;) {
    const text = (await ask("👤 Cliente > ")).trim();
    if (!text) continue;
    if (text === "/salir") break;
    if (text === "/reset") {
      clientPhone = String(573000000000 + Math.floor(Math.random() * 999999999)).slice(0, 12);
      console.log(`🔄 Nueva sesión con teléfono +${clientPhone}\n`);
      continue;
    }

    const prev = await getLatestLog(org._id);
    const prevCount = prev?.messages?.length || 0;
    const prevCreated = prev?.reservationCreated === true;

    try {
      await sendAsClient(org, text);
    } catch (err) {
      console.error(`❌ Error posteando al webhook: ${err.message}`);
      console.error(`   ¿Está corriendo el backend en ${API_URL}? (npm run dev)`);
      continue;
    }

    process.stdout.write("🤖 Bot está escribiendo...");
    const { reply, log } = await waitForReply(org._id, prevCount);
    process.stdout.write("\r\x1b[K");

    if (reply === null) {
      console.log("⏱️  Sin respuesta en 90s — revisa los logs del backend.\n");
      continue;
    }

    console.log(`🤖 Bot > ${reply}\n`);
    if (log?.reservationCreated && !prevCreated) {
      console.log("🎉 ¡RESERVA CREADA! (reservationCreated=true en ChatLog)\n");
    }
  }

  rl.close();
  await mongoose.disconnect();
  console.log("👋 Fin del test.");
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
