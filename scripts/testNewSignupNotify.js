/**
 * Diagnóstico: intenta enviar la notificación de nuevo registro y muestra el
 * error COMPLETO de Meta (que en producción se traga). Envía un mensaje real al
 * WHATSAPP_NEW_SIGNUP_NOTIFY_PHONE.
 *
 * Uso: NODE_ENV=production node scripts/testNewSignupNotify.js
 */
import dotenv from "dotenv";
dotenv.config({ path: process.env.NODE_ENV === "production" ? ".env.production" : ".env.development" });

import { sendTemplateMessage } from "../src/services/metaApiService.js";

const phone = process.env.WHATSAPP_NEW_SIGNUP_NOTIFY_PHONE;
console.log("Notify phone:", phone);
console.log("Phone number id:", process.env.META_PLATFORM_PHONE_NUMBER_ID);
console.log("Token (primeros 10):", (process.env.META_PLATFORM_ACCESS_TOKEN || "").slice(0, 10), "…");

try {
  const r = await sendTemplateMessage(phone, "nuevo_registro", "es", [
    {
      type: "body",
      parameters: [
        { type: "text", text: "Negocio de Prueba" },
        { type: "text", text: "Dueño Prueba" },
        { type: "text", text: "+573001234567" },
        { type: "text", text: "prueba@correo.com" },
      ],
    },
  ]);
  console.log("\n✓ ENVIADO. messageId:", r.messageId);
} catch (err) {
  console.log("\n✖ ERROR de Meta:");
  console.dir(err.response?.data || err.message, { depth: 6 });
}
process.exit(0);
