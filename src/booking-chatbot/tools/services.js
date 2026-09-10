import Service from "../../models/serviceModel.js";

export const getServices = {
  name: "get_services",
  description:
    "Obtiene los servicios activos disponibles para reservar, con los destacados (featured: true) primero. Llama esto al inicio de la conversación. Cuando el cliente pida sugerencias o no sepa qué elegir, menciona primero los servicios destacados.",
  parameters: {},
  handler: async (_params, { organizationId }) => {
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
        price: s.hidePrice ? null : s.price,
        priceHidden: s.hidePrice === true,
        description: s.description || "",
        featured: s.featured === true,
      })),
    };
  },
};
