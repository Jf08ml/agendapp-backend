// scripts/checkAiCostPerOrg.js
// Solo lectura. Estima cuánto cuesta la IA por organización y por plan en los
// últimos N días (por defecto 30), con precios actuales de Anthropic:
//   - Asistente de reservas (web + WhatsApp, ChatLog type "booking") → Sonnet 5.5
//   - Asistente del panel (ChatLog type "admin") → Haiku 4.5
//   - Agente admin por WhatsApp (WaBotMessage) → Haiku 4.5
//   - Validador de comprobantes (Order.receipt) → Haiku 4.5, tokens estimados
//
// Desde 2026-11-02 ChatLog/WaBotMessage guardan cacheReadTokens/cacheWriteTokens
// y se usan tal cual. Los logs anteriores solo tienen input_tokens SIN caché +
// output_tokens; para esos la caché se estima midiendo con count_tokens (gratis)
// el tamaño real de system prompt + tools de cada organización:
//   - escritura de caché: 1 por mensaje del cliente (supuesto conservador:
//     la caché de 5 min expiró entre mensajes)
//   - lectura de caché: 1 por cada ronda adicional dentro del mismo mensaje
//
// Uso (desde agendapp-backend/; src necesita babel-register):
//   node -e "require('@babel/register')({extensions:['.js']}); require('./scripts/checkAiCostPerOrg.js')" [dias]
import { config } from "dotenv";
import path from "path";
import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";
import dbConnection from "../src/config/db.js";
import ChatLog from "../src/models/chatLogModel.js";
import WaBotMessage from "../src/models/waBotMessageModel.js";
import Order from "../src/models/orderModel.js";
import Membership from "../src/models/membershipModel.js";
import Organization from "../src/models/organizationModel.js";
import "../src/models/planModel.js";
import { buildBookingSystemPrompt } from "../src/booking-chatbot/bookingSystemPrompt.js";
import { bookingClaudeTools, bookingClaudeToolsWhatsapp } from "../src/booking-chatbot/bookingToolRegistry.js";
import { buildSystemPrompt } from "../src/chatbot/systemPrompt.js";
import { claudeTools } from "../src/chatbot/toolRegistry.js";

config({ path: `.env.${process.env.NODE_ENV || "development"}` });

const DAYS = Number(process.argv[process.argv.length - 1]) || 30;

// USD por millón de tokens (escritura de caché = 1,25x input, lectura = 0,1x)
const PRICES = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};
const BOOKING_MODEL = "claude-sonnet-5-5";
const ADMIN_MODEL = "claude-haiku-4-5";

// Comprobante: imagen (~1.600 tokens a resolución máxima) + prompt, y JSON de salida
const RECEIPT_INPUT_TOKENS = 2500;
const RECEIPT_OUTPUT_TOKENS = 400;

const usd = (tokens, pricePerM) => (tokens * pricePerM) / 1e6;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Tamaño del prefijo cacheado (system + tools) medido con count_tokens.
// Un mensaje mínimo de usuario es obligatorio; se resta su costo aproximado.
const countPrefix = async (model, system, tools) => {
  const { input_tokens } = await anthropic.messages.countTokens({
    model,
    system,
    tools,
    messages: [{ role: "user", content: "hola" }],
  });
  return Math.max(input_tokens - 10, 0);
};

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (n) => `$${n.toFixed(2)}`;

async function run() {
  await dbConnection();
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  console.log(`\n✓ Conectado. Ventana: últimos ${DAYS} días (desde ${since.toISOString().slice(0, 10)})\n`);

  // ── Uso por organización ─────────────────────────────────────────────────
  const chatAgg = await ChatLog.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $project: {
        organizationId: 1,
        type: 1,
        channel: 1,
        rounds: { $ifNull: ["$rounds", 0] },
        inputTokens: { $ifNull: ["$inputTokens", 0] },
        outputTokens: { $ifNull: ["$outputTokens", 0] },
        cacheReadTokens: { $ifNull: ["$cacheReadTokens", 0] },
        cacheWriteTokens: { $ifNull: ["$cacheWriteTokens", 0] },
        userTurns: {
          $size: {
            $filter: { input: { $ifNull: ["$messages", []] }, cond: { $eq: ["$$this.role", "user"] } },
          },
        },
      },
    },
    // Logs desde 2026-11-02 traen la caché medida; los anteriores se estiman
    { $addFields: { measured: { $gt: [{ $add: ["$cacheReadTokens", "$cacheWriteTokens"] }, 0] } } },
    {
      $group: {
        _id: { org: "$organizationId", type: "$type", channel: "$channel" },
        sessions: { $sum: 1 },
        turns: { $sum: "$userTurns" },
        estRounds: { $sum: { $cond: ["$measured", 0, "$rounds"] } },
        estTurns: { $sum: { $cond: ["$measured", 0, "$userTurns"] } },
        inputTokens: { $sum: "$inputTokens" },
        outputTokens: { $sum: "$outputTokens" },
        cacheReadTokens: { $sum: "$cacheReadTokens" },
        cacheWriteTokens: { $sum: "$cacheWriteTokens" },
      },
    },
  ]);

  const waAdminAgg = await WaBotMessage.aggregate([
    { $match: { createdAt: { $gte: since }, role: "assistant" } },
    {
      $group: {
        _id: "$organizationId",
        replies: { $sum: 1 },
        inputTokens: { $sum: { $ifNull: ["$inputTokens", 0] } },
        outputTokens: { $sum: { $ifNull: ["$outputTokens", 0] } },
        cacheReadTokens: { $sum: { $ifNull: ["$cacheReadTokens", 0] } },
        cacheWriteTokens: { $sum: { $ifNull: ["$cacheWriteTokens", 0] } },
      },
    },
  ]);

  const receiptAgg = await Order.aggregate([
    { $match: { "receipt.uploadedAt": { $gte: since } } },
    { $group: { _id: "$organizationId", receipts: { $sum: { $max: [{ $ifNull: ["$receiptAttempts", 1] }, 1] } } } },
  ]);

  // ── Organizaciones con membresía vigente (incluye las que no usaron IA) ──
  const memberships = await Membership.find({ status: { $in: ["active", "trial", "past_due"] } })
    .sort({ updatedAt: -1 })
    .populate("planId", "slug displayName price")
    .lean();
  const planByOrg = new Map();
  for (const m of memberships) {
    const key = String(m.organizationId);
    if (!planByOrg.has(key)) planByOrg.set(key, { plan: m.planId?.slug || "sin-plan", status: m.status });
  }

  const orgIds = new Set([
    ...planByOrg.keys(),
    ...chatAgg.map((r) => String(r._id.org)),
    ...waAdminAgg.map((r) => String(r._id)),
    ...receiptAgg.map((r) => String(r._id)),
  ]);
  const orgs = await Organization.find({ _id: { $in: [...orgIds] } }).lean();
  const orgById = new Map(orgs.map((o) => [String(o._id), o]));

  // ── Tamaño del prefijo cacheado por org (solo las que usaron chat) ───────
  const prefixCache = new Map();
  const getPrefix = async (orgId, kind) => {
    const key = `${orgId}:${kind}`;
    if (prefixCache.has(key)) return prefixCache.get(key);
    const org = orgById.get(orgId);
    let tokens = 0;
    if (org) {
      try {
        if (kind === "admin") {
          const system = buildSystemPrompt({
            organizationId: org._id,
            organization: org,
            user: { name: "Admin" },
            currentDate: new Date().toISOString().slice(0, 10),
            setupStatus: { servicesCount: 1, employeesCount: 1, setupCompleted: org.setupCompleted || false },
          });
          tokens = await countPrefix(ADMIN_MODEL, system, claudeTools);
        } else {
          const channel = kind === "booking-whatsapp" ? "whatsapp" : "web";
          const system = buildBookingSystemPrompt(org, { channel });
          const tools = channel === "whatsapp" ? bookingClaudeToolsWhatsapp : bookingClaudeTools;
          tokens = await countPrefix(BOOKING_MODEL, system, tools);
        }
      } catch (err) {
        console.warn(`⚠ No se pudo medir el prompt ${kind} de ${org.name}: ${err.message}`);
      }
    }
    prefixCache.set(key, tokens);
    return tokens;
  };

  const rows = new Map();
  const rowFor = (orgId) => {
    if (!rows.has(orgId)) {
      const org = orgById.get(orgId);
      const p = planByOrg.get(orgId) || { plan: "sin-membresia-vigente", status: "-" };
      rows.set(orgId, {
        orgId,
        name: org?.name || "(org borrada)",
        plan: p.plan,
        status: p.status,
        bookingSessions: 0,
        bookingTurns: 0,
        adminSessions: 0,
        waAdminReplies: 0,
        receipts: 0,
        bookingUsd: 0,
        adminUsd: 0,
        waAdminUsd: 0,
        receiptUsd: 0,
        totalUsd: 0,
      });
    }
    return rows.get(orgId);
  };
  for (const orgId of planByOrg.keys()) rowFor(orgId);

  for (const r of chatAgg) {
    const orgId = String(r._id.org);
    const row = rowFor(orgId);
    const isBooking = r._id.type === "booking";
    const model = isBooking ? BOOKING_MODEL : ADMIN_MODEL;
    const price = PRICES[model];
    const kind = isBooking ? (r._id.channel === "whatsapp" ? "booking-whatsapp" : "booking-web") : "admin";
    const prefix = r.estRounds > 0 ? await getPrefix(orgId, kind) : 0;

    const estWrites = r.estTurns;
    const estReads = Math.max(r.estRounds - r.estTurns, 0);
    const cost =
      usd(r.inputTokens, price.input) +
      usd(r.outputTokens, price.output) +
      usd(r.cacheWriteTokens + estWrites * prefix, price.cacheWrite) +
      usd(r.cacheReadTokens + estReads * prefix, price.cacheRead);

    if (isBooking) {
      row.bookingSessions += r.sessions;
      row.bookingTurns += r.turns;
      row.bookingUsd += cost;
    } else {
      row.adminSessions += r.sessions;
      row.adminUsd += cost;
    }
  }

  // Agente admin por WhatsApp: antes del 2026-11-02 sin caché registrada (cota inferior)
  for (const r of waAdminAgg) {
    const row = rowFor(String(r._id));
    const price = PRICES[ADMIN_MODEL];
    row.waAdminReplies += r.replies;
    row.waAdminUsd +=
      usd(r.inputTokens, price.input) +
      usd(r.outputTokens, price.output) +
      usd(r.cacheWriteTokens, price.cacheWrite) +
      usd(r.cacheReadTokens, price.cacheRead);
  }

  for (const r of receiptAgg) {
    const row = rowFor(String(r._id));
    const price = PRICES[ADMIN_MODEL];
    row.receipts += r.receipts;
    row.receiptUsd += r.receipts * (usd(RECEIPT_INPUT_TOKENS, price.input) + usd(RECEIPT_OUTPUT_TOKENS, price.output));
  }

  for (const row of rows.values()) {
    row.totalUsd = row.bookingUsd + row.adminUsd + row.waAdminUsd + row.receiptUsd;
  }

  // ── Resumen por plan ─────────────────────────────────────────────────────
  const byPlan = new Map();
  for (const row of rows.values()) {
    if (!byPlan.has(row.plan)) byPlan.set(row.plan, []);
    byPlan.get(row.plan).push(row);
  }

  console.log(`Costo de IA por organización en ${DAYS} días (USD), agrupado por plan:\n`);
  const summary = [];
  for (const [plan, list] of [...byPlan.entries()].sort()) {
    const totals = list.map((r) => r.totalUsd);
    const withUse = list.filter((r) => r.totalUsd > 0);
    const s = {
      plan,
      orgs: list.length,
      orgsConIA: withUse.length,
      promedio: totals.reduce((a, b) => a + b, 0) / (list.length || 1),
      promedioConIA: withUse.reduce((a, r) => a + r.totalUsd, 0) / (withUse.length || 1),
      mediana: median(totals),
      p90: percentile(totals, 90),
      max: Math.max(0, ...totals),
      total: totals.reduce((a, b) => a + b, 0),
    };
    summary.push(s);
    console.log(
      `${plan.padEnd(32)} orgs=${String(s.orgs).padStart(3)}  con IA=${String(s.orgsConIA).padStart(3)}  ` +
        `prom=${fmt(s.promedio).padStart(7)}  prom(con IA)=${fmt(s.promedioConIA).padStart(7)}  ` +
        `mediana=${fmt(s.mediana).padStart(7)}  p90=${fmt(s.p90).padStart(7)}  max=${fmt(s.max).padStart(7)}  total=${fmt(s.total)}`
    );
  }

  console.log(`\nTop 15 organizaciones por costo:\n`);
  const top = [...rows.values()].sort((a, b) => b.totalUsd - a.totalUsd).slice(0, 15);
  for (const r of top) {
    console.log(
      `${fmt(r.totalUsd).padStart(8)}  ${r.name.slice(0, 32).padEnd(32)} ${r.plan.padEnd(24)} ${r.status.padEnd(8)} ` +
        `reservas=${fmt(r.bookingUsd)} (${r.bookingSessions} chats/${r.bookingTurns} msjs)  panel=${fmt(r.adminUsd)} (${r.adminSessions})  ` +
        `waAdmin=${fmt(r.waAdminUsd)} (${r.waAdminReplies})  comprobantes=${fmt(r.receiptUsd)} (${r.receipts})`
    );
  }

  const measured = [...prefixCache.entries()].filter(([, t]) => t > 0);
  const avgPrefix = (kind) => {
    const v = measured.filter(([k]) => k.endsWith(`:${kind}`)).map(([, t]) => t);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0;
  };
  console.log(
    `\nPrefijo cacheado promedio (tokens): reservas web=${avgPrefix("booking-web")}, ` +
      `reservas WhatsApp=${avgPrefix("booking-whatsapp")}, panel=${avgPrefix("admin")}`
  );

  const outDir = process.env.AI_COST_OUT_DIR || "scripts";
  const outFile = path.join(outDir, `aiCostPerOrg-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ days: DAYS, prices: PRICES, summary, orgs: [...rows.values()] }, null, 2));
  console.log(`\nDetalle completo en ${outFile}`);
  process.exit(0);
}

run().catch((err) => {
  console.error("\n❌ Error:", err);
  process.exit(1);
});
