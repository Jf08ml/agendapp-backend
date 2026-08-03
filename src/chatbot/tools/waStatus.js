export default [
  {
    name: "get_whatsapp_connection_status",
    description:
      "Consulta si el WhatsApp del negocio está conectado y por qué canal (WhatsApp Web/Baileys o Meta Cloud API), y si los agentes de IA por WhatsApp están activados. Úsala cuando el usuario pregunte si su WhatsApp está conectado o funcionando.",
    parameters: {},
    handler: async (_params, context) => {
      const org = context.organization;
      const usesMeta = org.waConnectionType === "meta";

      const baileysConnected = !!org.clientIdWhatsapp && !usesMeta;
      const metaConnected = usesMeta && !!org.metaPhoneNumberId;

      return {
        success: true,
        conectado: baileysConnected || metaConnected,
        canal: metaConnected ? "Meta Cloud API" : baileysConnected ? "WhatsApp Web (código QR)" : null,
        agenteAdminActivo: !!org.waAgentEnabled,
        agenteReservasActivo: !!org.waBookingAgentEnabled,
        _instruction: !(baileysConnected || metaConnected)
          ? "El negocio no tiene WhatsApp conectado. Guía al usuario a 'Gestionar WhatsApp' en el menú lateral (/gestionar-whatsapp) para conectarlo escaneando el código QR."
          : undefined,
      };
    },
  },
];
