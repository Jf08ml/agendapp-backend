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

    // Infobip
    // try {
    //   const infobip = new Infobip({
    //     baseUrl: "https://m3x6v2.api.infobip.com", // Base URL de Infobip
    //     apiKey:
    //       "337d72b7fc56cb5604450b3d438eff61-2f481251-9bc7-49a8-8c4e-9f0429052e9b",
    //     authType: AuthType.ApiKey,
    //   });

    //   // Estructura de datos según la API de Infobip
    //   const postData = {
    //     messages: [
    //       {
    //         from: "447860099299",
    //         to: phone,
    //         messageId: "b028163a-c149-4b13-933c-a3e6c5e0aa35",
    //         content: {
    //           templateName: "test_whatsapp_template_en",
    //           templateData: {
    //             body: {
    //               placeholders: [message, ...appointmentDetails],
    //             },
    //           },
    //           language: "en",
    //         },
    //       },
    //     ],
    //   };

    //   const response = await infobip.channels.whatsapp.send(postData);

    //   return {
    //     message: "Mensaje enviado correctamente",
    //     data: response,
    //   };
    // } catch (error) {
    //   throw new Error(`Error al enviar mensaje de WhatsApp: ${error.message}`);
    // }
  },

  sendWhatsappStatusReservation: async (status, phone, reservationDetails) => {
    // twilo
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const client = require("twilio")(accountSid, authToken);

      await client.messages.create({
        contentSid: status === "approved" ? "HX1b3c37e9450f9af80702eae7a01ecc41": "HX3c8a17fed3dc853f82d4eaabdb115857",
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
};

export default whatsappService;
