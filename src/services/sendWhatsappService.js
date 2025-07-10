import axios from "axios";
import organizationService from "./organizationService";

/**
 * Formatea cualquier número a internacional para WhatsApp
 * Si es local o internacional sin código de país, le añade el código de país
 * Si ya tiene el código de país, solo lo limpia
 * @param {string|number} phone - Número a formatear
 * @param {string} countryCode - Código de país (sin +), por ejemplo "57"
 * @param {number} localLength - Longitud del número local, por ejemplo 10
 * @returns {string} Número listo para WhatsApp
 */
function formatPhone(phone, countryCode = "57", localLength = 10) {
  if (!phone) return "";

  // Quita todo lo que no sea número
  let digits = phone.toString().replace(/\D/g, "");

  // Elimina ceros internacionales al inicio (ej: 0034...)
  while (digits.startsWith("00")) {
    digits = digits.slice(2);
  }
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  // Si ya comienza con el código de país (ej: 57, 34, 52, etc.) y tiene el largo internacional, lo deja igual
  if (digits.startsWith(countryCode) && digits.length === countryCode.length + localLength) {
    return digits;
  }

  // Si tiene la longitud local, añade el código de país
  if (digits.length === localLength) {
    return countryCode + digits;
  }

  // Si tiene longitud internacional pero NO empieza con el código de país, se lo agregamos (por si viene de 001234567890, 1234567890, etc.)
  if (
    digits.length > localLength &&
    !digits.startsWith(countryCode)
  ) {
    return countryCode + digits;
  }

  // Si no es reconocible, igual lo retorna limpio
  console.warn("Número de teléfono en formato inesperado:", phone, digits);
  return digits;
}


const whatsappService = {
  sendWhatsappReminder: async (phone, appointmentDetails) => {
    // twilo
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const client = require("twilio")(accountSid, authToken);

      await client.messages.create({
        contentSid: "HXc1cdd029c3eba4a1f303fd922ee74da6",
        contentVariables: JSON.stringify({ ...appointmentDetails }),
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: `whatsapp:+57${phone}`,
      });

      return { message: "Mensaje enviado correctamente" };
    } catch (error) {
      throw new Error(error.message);
    }
  },

  sendWhatsappStatusReservationTwilo: async (
    status,
    phone,
    reservationDetails
  ) => {
    // twilo
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
        to: `whatsapp:+57${phone}`,
      });

      return { message: "Mensaje enviado correctamente" };
    } catch (error) {
      throw new Error(error.message);
    }
  },

  sendWhatsappScheduleAppointment: async (phone, appointmentDetails) => {
    // twilo
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const client = require("twilio")(accountSid, authToken);

      await client.messages.create({
        contentSid: "HX78a056237b71cb5f3232722cbf09b63d",
        contentVariables: JSON.stringify({ ...appointmentDetails }),
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: `whatsapp:+57${phone}`,
      });

      return { message: "Mensaje enviado correctamente" };
    } catch (error) {
      throw new Error(error.message);
    }
  },

  /**
   * Envía un mensaje de WhatsApp usando la API multi-sesión
   * @param {String} organizationId - El ID de la organización
   * @param {String} phone - Número de teléfono destino (solo números, sin +)
   * @param {String} message - Mensaje de texto
   * @param {String} [image] - (opcional) Imagen (url o base64)
   */
sendMessage: async (organizationId, phone, message, image) => {
  // 1. Busca la organización para obtener su clientIdWhatsapp
  const org = await organizationService.getOrganizationById(organizationId);
  if (!org || !org.clientIdWhatsapp) {
    throw new Error("La organización no tiene sesión de WhatsApp configurada");
  }

  // 2. Formatea el número
  const formattedPhone = formatPhone(phone);

  // 3. Prepara el payload
  const payload = {
    clientId: org.clientIdWhatsapp,
    phone: formattedPhone,
    message,
  };
  if (image) payload.image = image;

  // 4. Enviar request al backend multi-sesión
  try {
    const { data } = await axios.post(
      "https://apiwp.zybizobazar.com/api/send",
      payload
    );
    return data;
  } catch (error) {
    if (error.response) {
      console.error("❌ Error respuesta WhatsApp API:", error.response.data);
      throw new Error(
        `Error WhatsApp API: ${JSON.stringify(error.response.data)}`
      );
    }
    console.error("❌ Error general al enviar WhatsApp:", error.message);
    throw error;
  }
},


  /**
   * Envía un mensaje de WhatsApp al cliente notificando el estado de su reserva (aprobada o rechazada),
   * usando la API multi-sesión de WhatsApp de la organización correspondiente.
   *
   * @param {('approved'|'rejected')} status - Estado de la reserva ("approved" para aprobada, "rejected" para rechazada).
   * @param {Object} reservation - Objeto de la reserva, debe estar popularizado e incluir 'organizationId' y 'customerDetails'.
   * @param {Object} reservationDetails - Detalles para personalizar el mensaje (names, date, organization, service, phoneNumber, etc).
   * @returns {Promise<Object>} Resultado con mensaje de éxito.
   * @throws {Error} Si no hay sesión de WhatsApp configurada o si ocurre algún error en el envío.
   */
  sendWhatsappStatusReservation: async (
    status,
    reservation,
    reservationDetails
  ) => {
    // Busca la organización para obtener su clientIdWhatsapp
    const org = reservation.organizationId;
    if (!org?.clientIdWhatsapp) {
      throw new Error(
        "La organización no tiene sesión de WhatsApp configurada"
      );
    }

    // Elige la plantilla según el status
    let msg;
    if (status === "approved") {
      msg = whatsappTemplates.statusReservationApproved(reservationDetails);
    } else {
      msg = whatsappTemplates.statusReservationRejected(reservationDetails);
    }

    // Envía el mensaje usando tu backend de WhatsApp
    try {
      await axios.post("https://apiwp.zybizobazar.com/api/send", {
        clientId: org.clientIdWhatsapp,
        phone: formatPhone(reservation.customerDetails?.phone),
        message: msg,
      });
      return { message: "Mensaje enviado correctamente" };
    } catch (error) {
      throw new Error(error?.response?.data?.error || error.message);
    }
  },
};

export default whatsappService;
