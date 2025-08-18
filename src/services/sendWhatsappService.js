// src/services/whatsappService.js
import axiosBase from "axios";
import organizationService from "./organizationService.js";
import whatsappTemplates from "../utils/whatsappTemplates.js";

/** ===================== CONFIG ===================== */
const BASE_URL =
  process.env.WHATSAPP_API_URL || process.env.VITE_API_URL_WHATSAPP; // ej: https://apiwp.zybizobazar.com
const API_KEY = process.env.WHATSAPP_API_KEY || process.env.VITE_API_KEY; // el mismo del backend

if (!BASE_URL)
  console.warn(
    "[whatsappService] WHATSAPP_API_URL / VITE_API_URL_WHATSAPP no definido"
  );
if (!API_KEY)
  console.warn("[whatsappService] WHATSAPP_API_KEY / VITE_API_KEY no definido");

const api = axiosBase.create({
  baseURL: (BASE_URL || "").replace(/\/$/, ""),
  headers: { "x-api-key": API_KEY },
  timeout: 20_000,
});
/** =================================================== */

/**
 * Normaliza un teléfono hacia formato internacional (E.164 sin '+').
 * - Limpia caracteres no numéricos
 * - Quita '00' o '0' iniciales
 * - Prefija el código de país si hace falta (por defecto CO: 57)
 */
export function formatPhone(phone, countryCode = "57", localLength = 10) {
  if (!phone) return "";
  let digits = String(phone).replace(/\D/g, "");

  while (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);

  if (
    digits.startsWith(countryCode) &&
    digits.length === countryCode.length + localLength
  ) {
    return digits;
  }
  if (digits.length === localLength) {
    return countryCode + digits;
  }
  if (digits.length > localLength && !digits.startsWith(countryCode)) {
    return countryCode + digits;
  }

  console.warn("[formatPhone] Formato inesperado:", phone, "=>", digits);
  return digits;
}

const whatsappService = {
  /** ===================== TWILIO (opcional en servidor) ===================== */
  async sendWhatsappReminder(phone, appointmentDetails) {
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const client = require("twilio")(accountSid, authToken);

      await client.messages.create({
        contentSid: "HXc1cdd029c3eba4a1f303fd922ee74da6",
        contentVariables: JSON.stringify({ ...appointmentDetails }),
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: `whatsapp:+${formatPhone(phone)}`,
      });
      return { message: "Mensaje enviado correctamente" };
    } catch (error) {
      throw new Error(error.message);
    }
  },

  async sendWhatsappStatusReservationTwilo(status, phone, reservationDetails) {
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const client = require("twilio")(accountSid, authToken);

      await client.messages.create({
        contentSid:
          status === "approved"
            ? "HX1b3c37e9450f9af80702eae7a01ecc41"
            : "HX3c8a17fed3dc853f82d4eaabdb115857",
        contentVariables: JSON.stringify({ ...reservationDetails }),
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: `whatsapp:+${formatPhone(phone)}`,
      });

      return { message: "Mensaje enviado correctamente" };
    } catch (error) {
      throw new Error(error.message);
    }
  },

  async sendWhatsappScheduleAppointment(phone, appointmentDetails) {
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const client = require("twilio")(accountSid, authToken);

      await client.messages.create({
        contentSid: "HX78a056237b71cb5f3232722cbf09b63d",
        contentVariables: JSON.stringify({ ...appointmentDetails }),
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: `whatsapp:+${formatPhone(phone)}`,
      });

      return { message: "Mensaje enviado correctamente" };
    } catch (error) {
      throw new Error(error.message);
    }
  },
  /** ======================================================================== */

  /** ===================== Multi-sesión (wwebjs) ===================== */

  // Idempotente: asegura que la sesión exista en el backend
  async ensureSession(clientId) {
    if (!clientId) return;
    try {
      await api.post(`/api/session`, { clientId });
    } catch (e) {
      // No rompemos el flujo: el /api/send también intentará
      console.warn(
        "[whatsappService.ensureSession] No se pudo asegurar sesión:",
        e?.message
      );
    }
  },

  // Enviar con reintento suave si es el clásico "Session/Target closed"
  async sendViaMultiSession(payload) {
    await this.ensureSession(payload.clientId);

    try {
      const { data } = await api.post(`/api/send`, payload);
      return data;
    } catch (error) {
      // error enriquecido desde backend
      if (error?.response?.data) {
        const body = error.response.data;
        const raw = String(body.error || "");
        if (
          /Session closed|Target closed|Protocol error|WebSocket is not open/i.test(
            raw
          )
        ) {
          // breve espera y reintento (el backend suele re-inicializar)
          await new Promise((r) => setTimeout(r, 800));
          const { data } = await api.post(`/api/send`, payload);
          return data;
        }
        throw new Error(body.error || "Error WhatsApp API");
      }
      throw new Error(error?.message || "Error de red enviando WhatsApp");
    }
  },

  /**
   * Envía un mensaje usando la sesión WA de la organización.
   * @param {string} organizationId
   * @param {string} phone
   * @param {string} message
   * @param {string} [image] url o base64
   */
  async sendMessage(organizationId, phone, message, image) {
    const org = await organizationService.getOrganizationById(organizationId);
    if (!org || !org.clientIdWhatsapp) {
      throw new Error(
        "La organización no tiene sesión de WhatsApp configurada"
      );
    }

    const payload = {
      clientId: org.clientIdWhatsapp,
      phone: formatPhone(phone),
      message,
    };
    if (image) payload.image = image;

    return this.sendViaMultiSession(payload);
  },

  /**
   * Notifica estado de reserva (aprobada/rechazada) por la sesión WA de la organización.
   */
  async sendWhatsappStatusReservation(status, reservation, reservationDetails) {
    const org = reservation?.organizationId;
    if (!org?.clientIdWhatsapp) {
      throw new Error(
        "La organización no tiene sesión de WhatsApp configurada"
      );
    }

    const msg =
      status === "approved"
        ? whatsappTemplates.statusReservationApproved(reservationDetails)
        : whatsappTemplates.statusReservationRejected(reservationDetails);

    const payload = {
      clientId: org.clientIdWhatsapp,
      phone: formatPhone(reservation?.customerDetails?.phone),
      message: msg,
    };

    return this.sendViaMultiSession(payload);
  },
};

export default whatsappService;
