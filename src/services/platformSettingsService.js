import PlatformSettings from "../models/platformSettingsModel.js";

const EDITABLE_KEYS = ["retargetingEnabled", "waDisconnectWhatsappAlertEnabled", "trialNudgeEnabled"];

// Valor de cada clave si el documento (o el campo) todavía no existe.
const DEFAULTS = { retargetingEnabled: false, waDisconnectWhatsappAlertEnabled: false, trialNudgeEnabled: true };

function toSettings(doc) {
  const settings = {};
  for (const key of EDITABLE_KEYS) settings[key] = typeof doc?.[key] === "boolean" ? doc[key] : DEFAULTS[key];
  return settings;
}

/**
 * Lee la configuración global. Nunca lanza: ante cualquier error devuelve todo
 * APAGADO, así un fallo de lectura jamás dispara envíos por WhatsApp. Si el
 * documento no existe, valen los DEFAULTS.
 */
export async function getPlatformSettings() {
  try {
    const doc = await PlatformSettings.findOne({ key: "global" }).lean();
    return toSettings(doc);
  } catch (err) {
    console.error("[platformSettings] No se pudo leer la configuración — se asume todo apagado:", err?.message);
    return Object.fromEntries(EDITABLE_KEYS.map((key) => [key, false]));
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
