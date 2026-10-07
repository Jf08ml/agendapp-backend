import Service from "../../models/serviceModel.js";

// Monedas donde un precio de 1 puede ser real (no se interpreta como placeholder).
const HARD_CURRENCIES = new Set(["USD", "EUR", "GBP", "PEN", "CAD", "AUD", "CHF", "BRL"]);

export const getServices = {
  name: "get_services",
  description:
    "Obtiene los servicios activos disponibles para reservar, con los destacados (featured: true) primero. Llama esto al inicio de la conversación. Cuando el cliente pida sugerencias o no sepa qué elegir, menciona primero los servicios destacados.",
  parameters: {},
  handler: async (_params, { organizationId, organization }) => {
    const currency = (organization?.currency || "COP").toUpperCase();
    const isPlaceholderPrice = (price) =>
      !HARD_CURRENCIES.has(currency) && price === 1;
    const services = await Service.find({ organizationId, isActive: true })
      .select("_id name type duration price description featured hidePrice")
      .sort({ _id: 1 })
      .lean();
    // Sort estable en JS: en BSON el campo ausente ordena distinto que false explícito
    services.sort((a, b) => (b.featured === true ? 1 : 0) - (a.featured === true ? 1 : 0));
    return {
      services: services.map((s) => ({
        id: s._id.toString(),
        name: s.name,
        type: s.type || "",
        durationMinutes: s.duration,
        // Si el negocio marcó el servicio con precio oculto, no se lo revelamos al modelo:
        // así no puede filtrarlo al cliente ni por accidente. Ver priceHidden.
        // En monedas de valor bajo por unidad (COP, CLP, PYG, CRC...) un precio de 1 es
        // el placeholder que usan los negocios para "precio a confirmar" (el bot
        // mostraba "Blower y planchado — $1"): se trata como precio oculto. En USD/EUR
        // $1 puede ser un precio real (ej. "Cejas $1"), así que ahí no aplica.
        price: s.hidePrice || isPlaceholderPrice(s.price) ? null : s.price,
        priceHidden: s.hidePrice === true || isPlaceholderPrice(s.price),
        description: s.description || "",
        featured: s.featured === true,
      })),
    };
  },
};
