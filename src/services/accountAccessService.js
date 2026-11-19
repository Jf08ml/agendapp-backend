import crypto from "crypto";
import bcrypt from "bcryptjs";
import Organization from "../models/organizationModel.js";
import AccessChallenge from "../models/accessChallengeModel.js";
import ExchangeCode from "../models/exchangeCodeModel.js";
import Session from "../models/sessionModel.js";
import { sendMail } from "./mailService.js";
import { sendTemplateMessage } from "./metaApiService.js";
import { logOutboundMessage } from "./platformInboxService.js";
import { notifyPasswordChanged } from "./accountNoticeService.js";
import { buildAccessCodeEmail } from "../utils/emailTemplates/accessEmails.js";
import { ACCESS_WA_LINE } from "../utils/panelLinks.js";
import { isRecipientAllowed } from "../utils/devRecipientGuard.js";
import {
  ACCESS_CODE_TTL_MINUTES,
  ACCESS_COMPLETE_TTL_MINUTES,
  ACCESS_MAX_ATTEMPTS,
  ACCESS_MAX_SENDS_PER_HOUR,
  ACCESS_RESEND_COOLDOWN_SECONDS,
  ACCESS_CODE_WA_TEMPLATE,
  MIN_PASSWORD_LENGTH,
  accessChannelsFor,
  accessPageUrl,
  codigoAccesoComponents,
  generateAccessCode,
  generateAccessToken,
  hashSecret,
  parseIdentifier,
  phoneMatchKey,
  sameHash,
} from "../utils/accountAccess.js";

// Recuperación del acceso al panel para DUEÑOS (Organization = usuario admin),
// sin saber la contraseña. Se usa en el dominio o subdominio del negocio
// (búsqueda limitada a ese negocio, sin captcha) y en app.agenditapp.com
// (búsqueda en todos los negocios, con Turnstile en el controlador):
//   1. lookup(correo o celular) → negocios con destinos enmascarados
//   2. sendCode(negocio, canal) → código de 6 dígitos por correo (con enlace) o WhatsApp
//   3. verify(código o enlace)  → completionToken
//   4. complete(completionToken, contraseña nueva opcional) → ExchangeCode, que el
//      frontend canjea en /exchange del dominio del negocio (el mismo flujo del registro).
// Los empleados no entran aquí: su contraseña la cambia el dueño.

export class AccessError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

const OWNER_FIELDS = "_id name ownerName email phoneNumber slug domains timezone ownerEmailBounce";

const isObjectId = (v) => /^[a-f0-9]{24}$/i.test(String(v ?? ""));

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @param {string} identifier - correo o celular del dueño
 * @param {string} [organizationId] - limita la búsqueda a ese negocio (página del negocio)
 */
async function findOwners(identifier, organizationId) {
  const parsed = parseIdentifier(identifier);
  if (!parsed) throw new AccessError("invalid_identifier", "Escribe tu correo o tu número de celular.");
  if (organizationId && !isObjectId(organizationId)) {
    throw new AccessError("not_found", "No encontramos ese negocio.", 404);
  }
  const scope = organizationId ? { _id: organizationId } : {};
  if (parsed.type === "email") {
    return Organization.find({ ...scope, email: parsed.value }).select(OWNER_FIELDS).limit(10).lean();
  }
  // Los teléfonos viejos no siempre están en E.164: se compara por los últimos
  // 10 dígitos. El código va al teléfono guardado, no al escrito.
  const key = phoneMatchKey(parsed.value);
  const loose = key.split("").map(escapeRegex).join("\\D*");
  const candidates = await Organization.find({ ...scope, phoneNumber: { $regex: `${loose}\\D*$` } })
    .select(OWNER_FIELDS)
    .limit(20)
    .lean();
  return candidates.filter((o) => phoneMatchKey(o.phoneNumber) === key).slice(0, 10);
}

/**
 * Negocios cuyo dueño tiene ese correo o celular, con los canales enmascarados.
 * No revela datos completos: solo nombre del negocio y destinos parciales.
 */
export async function lookup(identifier, organizationId) {
  const owners = await findOwners(identifier, organizationId);
  return owners.map((o) => ({
    organizationId: String(o._id),
    businessName: o.name,
    channels: accessChannelsFor(o),
  }));
}

/**
 * Crea un código y lo envía por el canal elegido. El identificador se vuelve a
 * comprobar contra el negocio para que nadie pueda disparar envíos a un negocio
 * con solo su id.
 */
export async function sendCode({ identifier, organizationId, channel, ip }) {
  if (!["email", "whatsapp"].includes(channel)) throw new AccessError("invalid_channel", "Canal no válido.");
  if (!isObjectId(organizationId)) throw new AccessError("not_found", "No encontramos ese negocio.", 404);
  const owners = await findOwners(identifier, organizationId);
  const org = owners.find((o) => String(o._id) === String(organizationId));
  if (!org) throw new AccessError("not_found", "No encontramos ese negocio con el dato que escribiste.", 404);

  const option = accessChannelsFor(org).find((c) => c.channel === channel);
  if (!option) throw new AccessError("channel_unavailable", "Ese negocio no tiene ese dato registrado.");
  if (!option.available) {
    throw new AccessError(
      "email_bounced",
      "Los correos a esa dirección no están llegando. Pide el código por WhatsApp.",
      400
    );
  }

  const now = Date.now();
  const recent = await AccessChallenge.find({
    organizationId: org._id,
    createdAt: { $gt: new Date(now - 60 * 60 * 1000) },
  })
    .select("createdAt channel")
    .sort({ createdAt: -1 })
    .lean();
  if (recent.length >= ACCESS_MAX_SENDS_PER_HOUR) {
    throw new AccessError("too_many_sends", "Pediste demasiados códigos. Espera una hora e inténtalo de nuevo.", 429);
  }
  const last = recent[0];
  if (last && now - new Date(last.createdAt).getTime() < ACCESS_RESEND_COOLDOWN_SECONDS * 1000) {
    const waitSeconds = Math.ceil((ACCESS_RESEND_COOLDOWN_SECONDS * 1000 - (now - new Date(last.createdAt).getTime())) / 1000);
    throw new AccessError("cooldown", `Espera ${waitSeconds} segundos para pedir otro código.`, 429, { waitSeconds });
  }

  const code = generateAccessCode();
  const linkToken = channel === "email" ? generateAccessToken() : null;
  const challenge = await AccessChallenge.create({
    organizationId: org._id,
    channel,
    destination: channel === "email" ? org.email : org.phoneNumber,
    codeHash: hashSecret(code),
    linkTokenHash: linkToken ? hashSecret(linkToken) : null,
    ip: ip || null,
    expiresAt: new Date(now + ACCESS_CODE_TTL_MINUTES * 60 * 1000),
  });

  // Un código nuevo invalida los anteriores del mismo negocio.
  await AccessChallenge.updateMany(
    { organizationId: org._id, _id: { $ne: challenge._id }, consumedAt: null },
    { $set: { consumedAt: new Date() } }
  );

  const sent =
    channel === "email"
      ? await sendCodeEmail(org, code, accessPageUrl(org, `c=${challenge._id}&t=${linkToken}`))
      : await sendCodeWhatsapp(org, code);

  if (!sent.ok) {
    await AccessChallenge.deleteOne({ _id: challenge._id });
    if (sent.skipped === "dev_not_allowed") {
      // Solo fuera de producción: el destino no está en DEV_NOTIFY_ALLOWLIST.
      console.log(`[accountAccess] (dev) código ${code} para ${org.slug} no enviado (${channel})`);
    }
    throw new AccessError(
      "send_failed",
      channel === "whatsapp"
        ? "No pudimos enviarte el WhatsApp. Inténtalo con tu correo o escríbenos."
        : "No pudimos enviarte el correo. Inténtalo con WhatsApp o escríbenos.",
      502
    );
  }

  return { challengeId: String(challenge._id), channel, masked: option.masked, expiresInMinutes: ACCESS_CODE_TTL_MINUTES };
}

async function sendCodeEmail(org, code, link) {
  const mail = buildAccessCodeEmail({ ownerName: org.ownerName, businessName: org.name, code, link });
  return sendMail({ to: org.email, ...mail });
}

async function sendCodeWhatsapp(org, code) {
  const phone = org.phoneNumber;
  if (!isRecipientAllowed(phone)) return { ok: false, skipped: "dev_not_allowed" };
  try {
    const { messageId } = await sendTemplateMessage(
      phone,
      ACCESS_CODE_WA_TEMPLATE,
      "es",
      codigoAccesoComponents(code),
      ACCESS_WA_LINE
    );
    // En el inbox de superadmin no se guarda el código.
    logOutboundMessage({
      phone,
      organizationId: org._id,
      body: `[Plantilla: ${ACCESS_CODE_WA_TEMPLATE}] Código de verificación enviado (oculto)`,
      source: "access",
      templateName: ACCESS_CODE_WA_TEMPLATE,
      metaMessageId: messageId,
      line: ACCESS_WA_LINE,
    }).catch(() => {});
    return { ok: true };
  } catch (err) {
    const metaError = err?.response?.data?.error;
    console.error(
      `[accountAccess] ${ACCESS_CODE_WA_TEMPLATE} (org=${org._id}):`,
      metaError ? `${metaError.code}: ${metaError.message}` : err?.message || err
    );
    return { ok: false, error: "whatsapp_failed" };
  }
}

/**
 * Valida el código (o el enlace del correo). Cada código admite
 * ACCESS_MAX_ATTEMPTS intentos; al acertar devuelve un token de un solo uso
 * para el paso final.
 */
export async function verify({ challengeId, code, token }) {
  if (!challengeId || !/^[a-f0-9]{24}$/i.test(String(challengeId))) {
    throw new AccessError("invalid_challenge", "El código venció. Pide uno nuevo.");
  }
  const challenge = await AccessChallenge.findById(challengeId);
  if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date()) {
    throw new AccessError("expired", "El código venció o ya se usó. Pide uno nuevo.", 410);
  }
  if (challenge.attempts >= ACCESS_MAX_ATTEMPTS) {
    throw new AccessError("too_many_attempts", "Demasiados intentos con este código. Pide uno nuevo.", 429);
  }

  // Contar el intento antes de comparar (atómico): evita probar códigos en paralelo.
  const counted = await AccessChallenge.findOneAndUpdate(
    { _id: challenge._id, attempts: { $lt: ACCESS_MAX_ATTEMPTS }, consumedAt: null },
    { $inc: { attempts: 1 } },
    { new: true }
  );
  if (!counted) throw new AccessError("too_many_attempts", "Demasiados intentos con este código. Pide uno nuevo.", 429);

  const ok = token
    ? Boolean(counted.linkTokenHash) && sameHash(hashSecret(String(token)), counted.linkTokenHash)
    : sameHash(hashSecret(String(code ?? "").replace(/\D/g, "")), counted.codeHash);
  if (!ok) {
    const left = ACCESS_MAX_ATTEMPTS - counted.attempts;
    throw new AccessError(
      token ? "invalid_link" : "wrong_code",
      token
        ? "Ese enlace ya no sirve. Pide un código nuevo."
        : left > 0
          ? `Código incorrecto. Te quedan ${left} intento${left === 1 ? "" : "s"}.`
          : "Código incorrecto. Pide uno nuevo.",
      400,
      { attemptsLeft: Math.max(left, 0) }
    );
  }

  const completionToken = generateAccessToken();
  counted.verifiedAt = new Date();
  counted.completionTokenHash = hashSecret(completionToken);
  counted.completionExpiresAt = new Date(Date.now() + ACCESS_COMPLETE_TTL_MINUTES * 60 * 1000);
  await counted.save();

  const org = await Organization.findById(counted.organizationId).select("name email").lean();
  return {
    completionToken,
    businessName: org?.name || "",
    email: org?.email || "",
  };
}

/**
 * Último paso: opcionalmente fija una contraseña nueva y crea el ExchangeCode
 * (2 min, un uso) para entrar al panel por {slug}.agenditapp.com/exchange.
 * Si la contraseña cambió, cierra las demás sesiones y avisa al dueño.
 */
export async function complete({ challengeId, completionToken, newPassword }) {
  if (!challengeId || !/^[a-f0-9]{24}$/i.test(String(challengeId)) || !completionToken) {
    throw new AccessError("invalid_challenge", "Vuelve a pedir un código.");
  }
  if (newPassword !== undefined && newPassword !== null && newPassword !== "") {
    if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new AccessError("weak_password", `La contraseña debe tener mínimo ${MIN_PASSWORD_LENGTH} caracteres.`);
    }
    if (newPassword.length > 200) throw new AccessError("weak_password", "La contraseña es demasiado larga.");
  }

  // Consumo atómico: el mismo token no sirve dos veces.
  const challenge = await AccessChallenge.findOneAndUpdate(
    {
      _id: challengeId,
      completionTokenHash: hashSecret(String(completionToken)),
      completionExpiresAt: { $gt: new Date() },
      consumedAt: null,
    },
    { $set: { consumedAt: new Date() } },
    { new: true }
  );
  if (!challenge) throw new AccessError("expired", "Pasó demasiado tiempo. Pide un código nuevo.", 410);

  const org = await Organization.findById(challenge.organizationId);
  if (!org) throw new AccessError("not_found", "No encontramos ese negocio.", 404);

  let passwordChanged = false;
  if (newPassword) {
    org.password = await bcrypt.hash(newPassword, 10);
    await org.save();
    passwordChanged = true;
    // Quien tenía la contraseña vieja no debe seguir dentro.
    await Session.updateMany(
      { organizationId: org._id, userId: org._id, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    ).catch((err) => console.error("[accountAccess] Revocar sesiones:", err?.message || err));
    notifyPasswordChanged(org).catch(() => {});
  }

  const code = crypto.randomBytes(32).toString("hex");
  await new ExchangeCode({
    code,
    userId: org._id, // la Organization ES el usuario admin
    organizationId: org._id,
    role: "admin",
    expiresAt: new Date(Date.now() + 2 * 60 * 1000),
  }).save();

  // Negocios viejos sin slug entran por su dominio propio.
  return { exchangeCode: code, slug: org.slug || null, domain: org.slug ? null : org.domains?.[0] || null, passwordChanged };
}
