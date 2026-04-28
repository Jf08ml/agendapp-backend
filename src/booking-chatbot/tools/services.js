import Service from "../../models/serviceModel.js";

export const getServices = {
  name: "get_services",
  description:
    "Obtiene los servicios activos disponibles para reservar. Llama esto al inicio de la conversación.",
  parameters: {},
  handler: async (_params, { organizationId }) => {
    const services = await Service.find({ organizationId, isActive: true })
      .select("_id name type duration price description")
      .lean();
    return {
      services: services.map((s) => ({
        id: s._id.toString(),
        name: s.name,
        type: s.type || "",
        durationMinutes: s.duration,
        price: s.price,
        description: s.description || "",
      })),
    };
  },
};
