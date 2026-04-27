import Service from "../../models/serviceModel.js";

export default [
  {
    name: "create_service",
    description:
      "Crea un nuevo servicio para la organización. Úsalo cuando el usuario quiera añadir un servicio (corte, masaje, consulta, etc.).",
    parameters: {
      name: { type: "string", description: "Nombre del servicio", required: true },
      type: { type: "string", description: "Categoría o tipo del servicio (ej: Corte, Masaje, Consulta, Tratamiento). Si el usuario no lo menciona, infiere uno apropiado según el nombre.", required: true },
      duration: { type: "number", description: "Duración en minutos (ej: 30, 45, 60)", required: true },
      price: { type: "number", description: "Precio del servicio en la moneda local", required: true },
      description: { type: "string", description: "Descripción breve del servicio para mostrársela al cliente (opcional)", required: false },
      recommendations: { type: "string", description: "Recomendaciones o instrucciones para el cliente antes de la cita (ej: 'Llegar sin maquillaje', 'No consumir cafeína 2h antes'). Opcional.", required: false },
      maxConcurrentAppointments: { type: "number", description: "Número de clientes que pueden ser atendidos simultáneamente por un profesional para este servicio. Por defecto 1. Útil para clases grupales o consultas múltiples.", required: false },
      costs: {
        type: "array",
        description: "Lista de gastos de insumos o materiales que genera este servicio. Cada item tiene 'concept' (descripción del gasto) y 'amount' (valor). Opcional.",
        required: false,
        items: {
          type: "object",
          properties: {
            concept: { type: "string" },
            amount: { type: "number" },
          },
        },
      },
    },
    handler: async (params, context) => {
      const service = await Service.create({
        name: params.name,
        type: params.type,
        duration: params.duration,
        price: params.price,
        description: params.description || "",
        recommendations: params.recommendations || null,
        maxConcurrentAppointments: params.maxConcurrentAppointments ?? 1,
        costs: Array.isArray(params.costs) ? params.costs : [],
        organizationId: context.organizationId,
      });
      return {
        success: true,
        service: {
          id: service._id,
          name: service.name,
          duration: service.duration,
          price: service.price,
          maxConcurrentAppointments: service.maxConcurrentAppointments,
        },
      };
    },
  },
  {
    name: "get_services",
    description: "Obtiene la lista de servicios configurados en la organización.",
    parameters: {},
    handler: async (_params, context) => {
      const services = await Service.find({ organizationId: context.organizationId, isActive: true })
        .select("name duration price description maxConcurrentAppointments");
      return {
        success: true,
        services: services.map((s) => ({
          id: s._id,
          name: s.name,
          duration: s.duration,
          price: s.price,
          maxConcurrentAppointments: s.maxConcurrentAppointments,
        })),
      };
    },
  },
];
