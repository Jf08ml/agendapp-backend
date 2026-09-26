// services/waHealthCheckService.js
//
// Detecta sesiones de WhatsApp (Baileys) que se cayeron sin que nadie se dé
// cuenta. Hoy el wa-backend solo avisa el cambio de estado por Socket.io a
// quien tenga abierta /gestionar-whatsapp en ese momento — si nadie la tiene
// abierta, la organización solo se entera cuando nota que dejó de mandar/
// recibir mensajes. Este servicio corre en cron/waHealthCheckJob.js (cada 15
// min) y usa GET /api/sessions del wa-backend (una sola llamada para todas
// las sesiones, ya protegida con el mismo WA_API_KEY que el resto de
// waHttpService.js) en vez de sondear cada org por separado.
//
// Solo vigila orgs que YA lograron conectar WhatsApp alguna vez
// (onboardingMilestones.whatsappConnectedAt) — evita avisar "se desconectó"
// a alguien que todavía está escaneando el QR por primera vez.
//
// Anti-falso-positivo: la primera vez que se ve "no ready" solo se marca
// waDisconnectAlert.downSince (no se avisa aún) — un blip que se autorecupera
// con el backoff exponencial del wa-backend (2s-30s) nunca llega a la
// siguiente corrida del cron. Solo se avisa si sigue caída en la corrida
// siguiente, y no se repite el aviso hasta que vuelva a "ready" (lo que
// resetea downSince/notifiedAt) y se caiga de nuevo.

import Organization from "../models/organizationModel.js";
import { waGetAllSessions } from "./waHttpService.js";
import notificationService from "./notificationService.js";
import subscriptionService from "./subscriptionService.js";
import { sendTextMessage } from "./metaApiService.js";
import { logOutboundMessage } from "./platformInboxService.js";
import { normalizeAdminPhone } from "./collection/adminPaymentNotifier.js";
import { getPlatformSettings } from "./platformSettingsService.js";

async function notifyWhatsappDisconnected(org) {
  const title = "WhatsApp desconectado ⚠️";
  const message = `El WhatsApp de ${org.name} se desconectó y dejó de enviar/recibir mensajes automáticos (recordatorios, confirmaciones, etc). Entra a Gestionar WhatsApp para volver a vincularlo.`;

  // 1) In-app + 2) Push (canales garantizados, no dependen de que WhatsApp esté vivo).
  await Promise.allSettled([
    notificationService.createNotification({
      title,
      message,
      organizationId: org._id,
      type: "system",
      frontendRoute: "/gestionar-whatsapp",
      status: "unread",
    }),
    subscriptionService.sendNotificationToUser(
      org._id,
      JSON.stringify({ title, message, icon: org?.branding?.pwaIcon })
    ),
  ]);

  // 3) Best-effort por el número de plataforma de AgenditApp: no hay plantilla
  // Meta aprobada para este aviso, así que va como texto libre — solo llega si
  // el dueño le escribió a AgenditApp en las últimas 24h (ventana de servicio
  // de Meta). Si falla, push + in-app ya cubrieron el aviso.
  // Solo si el superadmin lo tiene prendido (PlatformSettings.waDisconnectWhatsappAlertEnabled,
  // apagado por defecto); push + in-app salen siempre.
  const { waDisconnectWhatsappAlertEnabled } = await getPlatformSettings();
  if (!waDisconnectWhatsappAlertEnabled) return;

  const adminPhone = normalizeAdminPhone(org.phoneNumber);
  if (!adminPhone) return;
  try {
    const text =
      `⚠️ *WhatsApp desconectado*\n\n` +
      `El WhatsApp de *${org.name}* se desconectó y dejó de enviar/recibir mensajes automáticos.\n\n` +
      `Entra a tu panel → Gestionar WhatsApp para volver a vincularlo.`;
    const { messageId } = await sendTextMessage(adminPhone, text);
    await logOutboundMessage({
      phone: org.phoneNumber,
      organizationId: org._id,
      body: text,
      source: "alert",
      metaMessageId: messageId,
    });
  } catch (err) {
    console.warn(
      `[waHealthCheck] No se pudo avisar por WhatsApp a ${org._id} (probablemente sin ventana de 24h):`,
      err?.response?.data || err?.message
    );
  }
}

export async function checkWhatsappConnections() {
  let sessions;
  try {
    sessions = await waGetAllSessions();
  } catch (err) {
    console.error("[waHealthCheck] No se pudo obtener /api/sessions del wa-backend:", err?.message);
    return { checked: 0, notified: 0 };
  }

  const statusByClientId = new Map((sessions || []).map((s) => [s.clientId, s.status]));

  const candidates = await Organization.find({
    waConnectionType: { $ne: "meta" },
    clientIdWhatsapp: { $nin: [null, ""] },
    "onboardingMilestones.whatsappConnectedAt": { $ne: null },
  }).select("_id name phoneNumber clientIdWhatsapp branding waDisconnectAlert");

  let notified = 0;

  for (const org of candidates) {
    try {
      const isReady = statusByClientId.get(org.clientIdWhatsapp) === "ready";
      const { downSince, notifiedAt } = org.waDisconnectAlert || {};

      if (isReady) {
        if (downSince || notifiedAt) {
          await Organization.updateOne(
            { _id: org._id },
            { $set: { "waDisconnectAlert.downSince": null, "waDisconnectAlert.notifiedAt": null } }
          );
        }
        continue;
      }

      if (!downSince) {
        // Primera vez que se ve caída — solo se marca, sin avisar todavía.
        await Organization.updateOne(
          { _id: org._id, "waDisconnectAlert.downSince": null },
          { $set: { "waDisconnectAlert.downSince": new Date() } }
        );
        continue;
      }

      if (notifiedAt) continue; // ya se avisó esta caída, no repetir en cada corrida

      // Sigue caída en esta corrida y en la anterior → reclamo atómico + aviso
      // (evita doble aviso si el cron llegara a solaparse).
      const claimed = await Organization.findOneAndUpdate(
        { _id: org._id, "waDisconnectAlert.notifiedAt": null },
        { $set: { "waDisconnectAlert.notifiedAt": new Date() } }
      );
      if (!claimed) continue;

      await notifyWhatsappDisconnected(org);
      notified++;
    } catch (err) {
      console.error(`[waHealthCheck] Error procesando org ${org._id}:`, err?.message);
    }
  }

  return { checked: candidates.length, notified };
}

export default { checkWhatsappConnections };
