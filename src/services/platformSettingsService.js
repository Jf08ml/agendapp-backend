import PlatformSettings from "../models/platformSettingsModel.js";

const EDITABLE_KEYS = ["retargetingEnabled", "waDisconnectWhatsappAlertEnabled"];

function toSettings(doc) {
  const settings = {};
  for (const key of EDITABLE_KEYS) settings[key] = doc?.[key] === true;
  return settings;
}

/**
 * Lee la configuración global. Nunca lanza: ante cualquier error (o si el
 * documento no existe) devuelve todo APAGADO, así un fallo de lectura jamás
 * dispara envíos por WhatsApp.
 */
export async function getPlatformSettings() {
  try {
    const doc = await PlatformSettings.findOne({ key: "global" }).lean();
    return toSettings(doc);
  } catch (err) {
    console.error("[platformSettings] No se pudo leer la configuración — se asume todo apagado:", err?.message);
    return toSettings(null);
  }
}

/**
 * Actualiza solo las claves booleanas conocidas del patch. Devuelve la
 * configuración resultante, o null si el patch no traía ninguna clave válida.
 */
export async function updatePlatformSettings(patch) {
  const $set = {};
  for (const key of EDITABLE_KEYS) {
    if (typeof patch?.[key] === "boolean") $set[key] = patch[key];
  }
  if (Object.keys($set).length === 0) return null;

  const doc = await PlatformSettings.findOneAndUpdate(
    { key: "global" },
    { $set },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  ).lean();
  return toSettings(doc);
}
