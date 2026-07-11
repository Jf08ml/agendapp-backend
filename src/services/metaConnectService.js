/**
 * metaConnectService.js
 *
 * Dos flujos de conexión WhatsApp:
 *
 * A) WABA único de AgenditApp (Tech Provider) — vía SMS/Voz:
 *   1. requestVerification  → agrega número al WABA de plataforma, envía código
 *   2. verifyCode           → verifica el código recibido
 *   3. activateCoexistence / activateCloudOnly → activa el modo elegido
 *
 * B) WABA propio del cliente — vía Embedded Signup (FB popup):
 *   1. connectOrgEmbedded   → intercambia code, obtiene WABA + phone_number_id (sin /register)
 *   2. activateCoexistence / activateCloudOnly → activa el modo elegido (mismo paso 3)
 */

import axios from "axios";
import Organization from "../models/organizationModel.js";

const GRAPH_URL = "https://graph.facebook.com/v25.0";

function platformToken() {
  const token = process.env.META_SYSTEM_USER_TOKEN;
  if (!token) throw new Error("META_SYSTEM_USER_TOKEN no configurado en el servidor.");
  return token;
}

function platformWabaId() {
  const wabaId = process.env.META_WABA_ID;
  if (!wabaId) throw new Error("META_WABA_ID no configurado en el servidor.");
  return wabaId;
}

function graphClient() {
  return axios.create({
    baseURL: GRAPH_URL,
    params: { access_token: platformToken() },
  });
}

function makeClient(token) {
  return axios.create({ baseURL: GRAPH_URL, params: { access_token: token } });
}

/**
 * Si la org tiene metaWabaId (Embedded Signup) y el token primario falla
 * con código 100 (permiso insuficiente del system user sobre el WABA del cliente),
 * reintenta con metaAccessToken (token del dueño del negocio, que siempre tiene admin).
 * Mismo patrón que metaTemplateService.js — necesario porque connectOrgEmbedded
 * agrega el system user al WABA del cliente de forma best-effort (puede fallar sin bloquear la conexión).
 */
async function withOwnerTokenFallback(org, primaryToken, fn) {
  try {
    return await fn(primaryToken);
  } catch (err) {
    const isPermissionError = err.response?.data?.error?.code === 100;
    const hasOwnerToken = org.metaWabaId && org.metaAccessToken && org.metaAccessToken !== primaryToken;
    if (isPermissionError && hasOwnerToken) {
      console.warn("[metaConnect] System user sin permisos de admin en el WABA del cliente — reintentando con metaAccessToken");
      return fn(org.metaAccessToken);
    }
    throw err;
  }
}

/**
 * Paso 1: Agrega el número al WABA de AgenditApp y envía código de verificación.
 *
 * Si el número ya existe en el WABA, Meta devuelve el phone_number_id existente
 * y envía un nuevo código de verificación.
 *
 * @param {string} orgId
 * @param {string} cc          - Código de país sin + (ej: "57")
 * @param {string} phoneNumber - Número local sin código de país (ej: "3001234567")
 * @param {string} verifiedName - Nombre del negocio que aparece en WhatsApp
 * @param {string} method      - "SMS" | "VOICE"
 */
export async function requestVerification(orgId, cc, phoneNumber, verifiedName, method = "SMS") {
  const client = graphClient();
  const wabaId = platformWabaId();

  // Limpia el número: solo dígitos
  const cleanCc = String(cc).replace(/\D/g, "");
  const cleanPhone = String(phoneNumber).replace(/\D/g, "");

  if (!cleanCc || !cleanPhone) throw new Error("Código de país y número de teléfono son requeridos.");

  let phoneNumberId;
  let displayPhone = `+${cleanCc}${cleanPhone}`;

  try {
    const res = await client.post(`/${wabaId}/phone_numbers`, {
      cc: cleanCc,
      phone_number: cleanPhone,
      verified_name: verifiedName || "AgenditApp",
    });
    phoneNumberId = res.data.id;
  } catch (err) {
    const code = err.response?.data?.error?.code;
    const subcode = err.response?.data?.error?.error_subcode;

    // 2388085: el número ya existe en el WABA — obtener su ID
    if (code === 2388085 || subcode === 2388085) {
      const listRes = await client.get(`/${wabaId}/phone_numbers`, {
        params: { fields: "id,display_phone_number" },
      });
      const existing = listRes.data?.data?.find(
        (p) => p.display_phone_number?.replace(/\D/g, "").endsWith(cleanPhone)
      );
      if (!existing) throw new Error("Número ya registrado pero no encontrado en el WABA.");
      phoneNumberId = existing.id;
    } else {
      console.error("[metaConnect] Error al agregar número:", err.response?.data);
      throw err;
    }
  }

  // Solicitar el código de verificación (SMS o Voz) — paso siempre requerido
  await client.post(`/${phoneNumberId}/request_code`, {
    code_method: method,
    language: "es",
  });

  // Guardar phoneNumberId pendiente (waConnectionType permanece sin cambio hasta activar)
  await Organization.findByIdAndUpdate(orgId, {
    metaPhoneNumberId: phoneNumberId,
    metaPhone: displayPhone,
  });

  return { phoneNumberId, phone: displayPhone };
}

/**
 * Paso 2: Verifica el código recibido por SMS o Voz.
 * El phoneNumberId se toma del registro guardado en la org.
 *
 * @param {string} orgId
 * @param {string} code - Código de 6 dígitos
 */
export async function verifyCode(orgId, code) {
  const org = await Organization.findById(orgId)
    .select("metaPhoneNumberId metaPhone")
    .lean();

  if (!org?.metaPhoneNumberId) {
    throw new Error("No hay verificación pendiente. Solicita el código primero.");
  }

  const client = graphClient();
  await client.post(`/${org.metaPhoneNumberId}/verify_code`, { code });

  return { verified: true, phone: org.metaPhone };
}

/**
 * Paso 3a — Coexistencia (recomendado):
 * Activa el número para Cloud API SIN llamar a /register.
 * El número continúa funcionando en WhatsApp Business App.
 *
 * @param {string} orgId
 */
export async function activateCoexistence(orgId) {
  const org = await Organization.findById(orgId)
    .select("metaPhoneNumberId metaPhone")
    .lean();

  if (!org?.metaPhoneNumberId) {
    throw new Error("No hay número verificado para activar. Completa la verificación primero.");
  }

  await Organization.findByIdAndUpdate(orgId, {
    waConnectionType: "meta",
    metaCoexistenceEnabled: true,
  });

  console.log(`[metaConnect] Coexistencia activada para org ${orgId} — número: ${org.metaPhone}`);
  return { phone: org.metaPhone, coexistence: true };
}

/**
 * Paso 3b — Solo Cloud API:
 * Llama a /register con el PIN del usuario (existente o nuevo).
 * El número MIGRA fuera de WhatsApp Business App.
 *
 * @param {string} orgId
 * @param {string} pin - PIN de verificación de 6 dígitos
 */
export async function activateCloudOnly(orgId, pin) {
  const org = await Organization.findById(orgId)
    .select("metaPhoneNumberId metaPhone metaWabaId metaAccessToken")
    .lean();

  if (!org?.metaPhoneNumberId) {
    throw new Error("No hay número verificado para activar.");
  }

  if (!pin || !/^\d{6}$/.test(String(pin))) {
    throw new Error("El PIN debe ser de exactamente 6 dígitos numéricos.");
  }

  try {
    await withOwnerTokenFallback(org, platformToken(), (t) =>
      makeClient(t).post(`/${org.metaPhoneNumberId}/register`, {
        messaging_product: "whatsapp",
        pin,
      })
    );
    console.log(`[metaConnect] Cloud-only activado para org ${orgId} — número: ${org.metaPhone}`);
  } catch (err) {
    const code = err.response?.data?.error?.code;
    if (code === 133016) {
      // Ya estaba registrado — aceptable, continuar
      console.log(`[metaConnect] Número ya registrado (133016) — continuando`);
    } else if (code === 133015) {
      throw new Error("PIN incorrecto. Ingresa el PIN de verificación de 2 pasos de WhatsApp.");
    } else {
      console.error("[metaConnect] Error al registrar número:", err.response?.data);
      throw new Error(err.response?.data?.error?.message || "Error al registrar el número en Cloud API.");
    }
  }

  await Organization.findByIdAndUpdate(orgId, {
    waConnectionType: "meta",
    metaCoexistenceEnabled: false,
  });

  return { phone: org.metaPhone, coexistence: false };
}

/**
 * Verifica el estado actual de la conexión Meta de una org.
 */
export async function getMetaStatus(orgId) {
  const org = await Organization.findById(orgId)
    .select("waConnectionType metaPhoneNumberId metaPhone metaCoexistenceEnabled metaWabaId metaAccessToken")
    .lean();

  if (!org) throw new Error("Organización no encontrada.");

  const hasPhoneId = !!org.metaPhoneNumberId;
  const isActive = org.waConnectionType === "meta";

  if (!hasPhoneId) {
    return { connected: false, pending: false };
  }

  if (!isActive) {
    // phoneNumberId guardado pero aún no activado (verificación en progreso)
    return {
      connected: false,
      pending: true,
      phone: org.metaPhone,
      phoneNumberId: org.metaPhoneNumberId,
    };
  }

  // Verificar que el número sigue operativo en Meta
  try {
    const res = await withOwnerTokenFallback(org, platformToken(), (t) =>
      makeClient(t).get(`/${org.metaPhoneNumberId}`, {
        params: {
          fields: "id,display_phone_number,verified_name,platform_type,code_verification_status",
        },
      })
    );
    return {
      connected: true,
      pending: false,
      phone: org.metaPhone,
      phoneNumberId: org.metaPhoneNumberId,
      coexistence: !!org.metaCoexistenceEnabled,
      platformType: res.data.platform_type,
      verificationStatus: res.data.code_verification_status,
      verifiedName: res.data.verified_name,
    };
  } catch {
    // Token de plataforma inválido o número no encontrado
    return {
      connected: false,
      pending: false,
      reason: "platform_error",
    };
  }
}

/**
 * Flujo B — Embedded Signup (WABA propio del cliente):
 * Intercambia el code de OAuth por token de larga duración,
 * obtiene el WABA y phone_number_id, y los guarda en la org.
 * NO activa el número (no llama /register) — el usuario elige el modo después.
 *
 * @param {string} orgId
 * @param {string} code             - Code devuelto por FB.login
 * @param {string} redirectUri      - URI registrado en Meta (debe ser exacto)
 * @param {string} [providedWabaId]
 * @param {string} [providedPhoneNumberId]
 */
export async function connectOrgEmbedded(orgId, code, redirectUri, providedWabaId, providedPhoneNumberId) {
  const APP_ID = process.env.META_APP_ID;
  const APP_SECRET = process.env.META_APP_SECRET;

  if (!APP_ID || !APP_SECRET) throw new Error("META_APP_ID / META_APP_SECRET no configurados.");

  // 1. Intercambiar code por short token
  const shortRes = await axios.get(`${GRAPH_URL}/oauth/access_token`, {
    params: { client_id: APP_ID, client_secret: APP_SECRET, code },
  });
  const shortToken = shortRes.data.access_token;

  // 2. Convertir a long token (60 días)
  const longRes = await axios.get(`${GRAPH_URL}/oauth/access_token`, {
    params: { grant_type: "fb_exchange_token", client_id: APP_ID, client_secret: APP_SECRET, fb_exchange_token: shortToken },
  });
  const accessToken = longRes.data.access_token;

  // 3. Extraer WABA ID desde granular_scopes si no vino en authResponse
  let wabaId = providedWabaId;
  if (!wabaId) {
    const debugRes = await axios.get(`${GRAPH_URL}/debug_token`, {
      params: { input_token: accessToken, access_token: `${APP_ID}|${APP_SECRET}`, fields: "granular_scopes" },
    }).catch(() => null);
    const wabaScope = debugRes?.data?.data?.granular_scopes?.find(
      (s) => s.scope === "whatsapp_business_management"
    );
    wabaId = wabaScope?.target_ids?.[0];
  }
  if (!wabaId) throw new Error("No se encontró WhatsApp Business Account asociada.");

  // 4. Obtener phone number del WABA
  let phoneData;
  if (providedPhoneNumberId) {
    const r = await axios.get(`${GRAPH_URL}/${providedPhoneNumberId}`, {
      params: { access_token: accessToken, fields: "id,display_phone_number,verified_name" },
    });
    phoneData = r.data;
  } else {
    const r = await axios.get(`${GRAPH_URL}/${wabaId}/phone_numbers`, {
      params: { access_token: accessToken, fields: "id,display_phone_number,verified_name" },
    });
    phoneData = r.data?.data?.[0];
  }
  if (!phoneData) throw new Error("No se encontró número de teléfono en la WABA.");

  // 5. Suscribir el WABA al webhook de la app
  await axios.post(`${GRAPH_URL}/${wabaId}/subscribed_apps`, {}, { params: { access_token: accessToken } });

  // 6. Agregar el System User de AgenditApp al WABA del cliente
  //    Esto permite usar el token de plataforma para enviar mensajes (billing → AgenditApp)
  const systemUserId = process.env.META_SYSTEM_USER_ID;
  if (systemUserId) {
    try {
      await axios.post(
        `${GRAPH_URL}/${wabaId}/assigned_users`,
        { user: systemUserId, tasks: ["MANAGE", "DEVELOP", "ADVERTISE", "ANALYZE"] },
        { params: { access_token: accessToken } }
      );
      console.log(`[metaConnect] System user ${systemUserId} agregado al WABA ${wabaId}`);
    } catch (sysErr) {
      // 100 = ya estaba asignado — ignorar
      if (sysErr.response?.data?.error?.code !== 100) {
        console.warn(`[metaConnect] No se pudo agregar system user al WABA ${wabaId}:`, sysErr.response?.data?.error?.message || sysErr.message);
      }
    }
  }

  // 7. Asignar línea de crédito de AgenditApp al WABA del cliente
  const creditLineId = process.env.META_CREDIT_LINE_ID;
  if (creditLineId) {
    try {
      await axios.post(
        `${GRAPH_URL}/${creditLineId}/whatsapp_credit_sharing_and_attach`,
        { waba_id: wabaId, waba_currency: "COP" },
        { params: { access_token: platformToken() } }
      );
      console.log(`[metaConnect] Línea de crédito ${creditLineId} asignada al WABA ${wabaId}`);
    } catch (creditErr) {
      // Ya asignada o error no bloqueante — el cliente puede conectar igual, solo billing queda pendiente
      console.warn(`[metaConnect] No se pudo asignar línea de crédito al WABA ${wabaId}:`, creditErr.response?.data?.error?.message || creditErr.message);
    }
  }

  // 8. Guardar en la org (pendiente de activación — NO se llama /register)
  await Organization.findByIdAndUpdate(orgId, {
    metaWabaId: wabaId,
    metaPhoneNumberId: phoneData.id,
    metaAccessToken: accessToken,
    metaPhone: phoneData.display_phone_number,
    // waConnectionType queda null hasta que el usuario elige el modo
  });

  return {
    wabaId,
    phoneNumberId: phoneData.id,
    phone: phoneData.display_phone_number,
    verifiedName: phoneData.verified_name,
  };
}

/**
 * Desconecta Meta de la org.
 * Limpia los campos meta pero NO elimina el número del WABA
 * (puede reconectarse sin re-verificar).
 * Vuelve a Baileys si la org tiene waPhone configurado.
 *
 * @param {string} orgId
 */
export async function disconnectOrg(orgId) {
  const org = await Organization.findById(orgId).lean();
  if (!org) throw new Error("Organización no encontrada.");

  await Organization.findByIdAndUpdate(orgId, {
    waConnectionType: org.waPhone ? "baileys" : null,
    metaPhoneNumberId: null,
    metaPhone: null,
    metaCoexistenceEnabled: false,
    metaWabaId: null,
    metaAccessToken: null,
  });

  console.log(`[metaConnect] Org ${orgId} desconectada de Meta`);
}
