import mongoose from "mongoose";

// Configuración global de la plataforma: documento único (key "global") que el
// superadmin edita desde /superadmin/whatsapp. Gobierna los envíos automáticos
// por el número de WhatsApp de AgenditApp. retargetingEnabled y
// waDisconnectWhatsappAlertEnabled arrancan APAGADOS (default false);
// trialNudgeEnabled arranca PRENDIDO para no cambiar lo que ya se enviaba.
const platformSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },

    // Cron diario de retargeting de activación (activa_tu_cuenta,
    // agenda_tu_primera_cita, conecta_tu_whatsapp). NO incluye trial_por_vencer,
    // que va por membershipCheckJob.
    retargetingEnabled: { type: Boolean, default: false },

    // Tercer canal (WhatsApp) del aviso de sesión de WhatsApp caída. El push y el
    // aviso in-app no dependen de este flag.
    waDisconnectWhatsappAlertEnabled: { type: Boolean, default: false },

    // Aviso trial_por_vencer (membershipCheckJob). Se apaga cuando AgenditApp
    // Oficina IA pasa a enviar estos mensajes con aprobación humana.
    trialNudgeEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("PlatformSettings", platformSettingsSchema);
