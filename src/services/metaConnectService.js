import axios from "axios";
import Organization from "../models/organizationModel.js";

const GRAPH_URL = "https://graph.facebook.com/v25.0";
const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;

/**
 * Intercambia el code de Embedded Signup por token de larga duración,
 * obtiene el WABA y el phone number ID, y los guarda en la org.
 */
export async function connectOrg(orgId, code, redirectUri, providedWabaId, providedPhoneNumberId) {
  // 1. Intercambiar code por access token
  const tokenRes = await axios.get(`${GRAPH_URL}/oauth/access_token`, {
    params: {
      client_id: APP_ID,
      client_secret: APP_SECRET,
      code,
    },
  });
  const shortToken = tokenRes.data.access_token;

  // 2. Convertir a token de larga duración (60 días)
  const longRes = await axios.get(`${GRAPH_URL}/oauth/access_token`, {
    params: {
      grant_type: "fb_exchange_token",
      client_id: APP_ID,
      client_secret: APP_SECRET,
      fb_exchange_token: shortToken,
    },
  });
  const accessToken = longRes.data.access_token;

  // debug: verificar permisos del token
  const debugRes = await axios.get(`${GRAPH_URL}/debug_token`, {
    params: { input_token: accessToken, access_token: `${APP_ID}|${APP_SECRET}` },
  }).catch(() => null);
  console.log("[metaConnect] token scopes:", debugRes?.data?.data?.scopes);

  // 3. Obtener WABA ID — usar el del callback si viene, si no consultar API
  let wabaId = providedWabaId;
  console.log("[metaConnect] providedWabaId:", providedWabaId, "providedPhoneNumberId:", providedPhoneNumberId);
  if (!wabaId) {
    // Primero intentar /me/whatsapp_business_accounts (más directo)
    const directRes = await axios.get(`${GRAPH_URL}/me/whatsapp_business_accounts`, {
      params: { access_token: accessToken, fields: "id,name" },
    }).catch((e) => { console.log("[metaConnect] me/whatsapp_business_accounts error:", e.response?.data); return null; });
    console.log("[metaConnect] me/whatsapp_business_accounts:", JSON.stringify(directRes?.data));
    const directWaba = directRes?.data?.data?.[0];

    if (directWaba) {
      wabaId = directWaba.id;
    } else {
      // Fallback: buscar via me/businesses
      const wabaRes = await axios.get(`${GRAPH_URL}/me/businesses`, {
        params: { access_token: accessToken, fields: "id,name,whatsapp_business_accounts" },
      });
      const waba = wabaRes.data?.data?.[0]?.whatsapp_business_accounts?.data?.[0];
      if (!waba) throw new Error("No se encontró WhatsApp Business Account asociada.");
      wabaId = waba.id;
    }
  }

  // 4. Obtener phone numbers del WABA
  let phoneData;
  if (providedPhoneNumberId) {
    const phoneRes = await axios.get(`${GRAPH_URL}/${providedPhoneNumberId}`, {
      params: { access_token: accessToken, fields: "id,display_phone_number,verified_name" },
    });
    phoneData = phoneRes.data;
  } else {
    const phoneRes = await axios.get(`${GRAPH_URL}/${wabaId}/phone_numbers`, {
      params: { access_token: accessToken, fields: "id,display_phone_number,verified_name" },
    });
    phoneData = phoneRes.data?.data?.[0];
  }
  if (!phoneData) throw new Error("No se encontró número de teléfono en la WABA.");

  // 5. Suscribir el WABA al webhook de la app
  await axios.post(
    `${GRAPH_URL}/${wabaId}/subscribed_apps`,
    {},
    { params: { access_token: accessToken } }
  );

  // 6. Guardar en la org
  const org = await Organization.findByIdAndUpdate(
    orgId,
    {
      waConnectionType: "meta",
      metaWabaId: wabaId,
      metaPhoneNumberId: phoneData.id,
      metaAccessToken: accessToken,
      metaPhone: phoneData.display_phone_number,
    },
    { new: true }
  );

  return {
    wabaId,
    phoneNumberId: phoneData.id,
    phone: phoneData.display_phone_number,
    verifiedName: phoneData.verified_name,
  };
}

/**
 * Desconecta Meta de la org y vuelve al modo Baileys si tiene waPhone configurado.
 */
export async function disconnectOrg(orgId) {
  const org = await Organization.findById(orgId);
  if (!org) throw new Error("Organización no encontrada");

  // Desuscribir WABA del webhook si tiene token
  if (org.metaWabaId && org.metaAccessToken) {
    await axios
      .delete(`${GRAPH_URL}/${org.metaWabaId}/subscribed_apps`, {
        params: { access_token: org.metaAccessToken },
      })
      .catch((e) => console.warn("[metaConnect] No se pudo desuscribir WABA:", e.message));
  }

  await Organization.findByIdAndUpdate(orgId, {
    waConnectionType: org.waPhone ? "baileys" : null,
    metaWabaId: null,
    metaPhoneNumberId: null,
    metaAccessToken: null,
    metaPhone: null,
  });
}

/**
 * Devuelve el estado de la conexión Meta de una org.
 */
export async function getMetaStatus(orgId) {
  const org = await Organization.findById(orgId)
    .select("waConnectionType metaWabaId metaPhoneNumberId metaPhone metaAccessToken")
    .lean();

  if (!org) throw new Error("Organización no encontrada");
  if (org.waConnectionType !== "meta" || !org.metaPhoneNumberId) {
    return { connected: false };
  }

  // Verificar que el token sigue siendo válido
  try {
    await axios.get(`${GRAPH_URL}/${org.metaPhoneNumberId}`, {
      params: { access_token: org.metaAccessToken, fields: "id,display_phone_number,verified_name" },
    });
    return {
      connected: true,
      phone: org.metaPhone,
      wabaId: org.metaWabaId,
      phoneNumberId: org.metaPhoneNumberId,
    };
  } catch {
    return { connected: false, reason: "token_invalid" };
  }
}
