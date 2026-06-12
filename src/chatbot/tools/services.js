import Service from "../../models/serviceModel.js";

// Quita acentos, pasa a minúsculas y deja solo letras/números/espacios — para
// detectar duplicados con variaciones de tildes o mayúsculas ("Manicure básica" vs "Manicure Basico")
const normalizeForCompare = (str) =>
  String(str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export default [
  {
    name: "create_service",
    description:
      "Crea un nuevo servicio para la organización. Úsalo cuando el usuario quiera añadir un servicio (corte, masaje, consulta, etc.). Si ya existe un servicio con nombre muy similar, devuelve una advertencia — pregunta al usuario si realmente quiere crearlo y reintenta con force: true solo si confirma.",
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
      force: {
        type: "boolean",
        description: "Crear aunque exista un servicio con nombre similar. Úsalo SOLO después de que el usuario confirme explícitamente que quiere el duplicado.",
        required: false,
      },
    },
    handler: async (params, context) => {
      // Chequeo de duplicados: comparar nombre normalizado contra servicios activos existentes
      if (!params.force) {
        const existing = await Service.find({
          organizationId: context.organizationId,
          isActive: true,
        }).select("name duration price");
        const newNorm = normalizeForCompare(params.name);
        const similar = existing.filter((s) => {
          const norm = normalizeForCompare(s.name);
          return norm === newNorm || norm.includes(newNorm) || newNorm.includes(norm);
        });
        if (similar.length > 0) {
          return {
            success: false,
            duplicateWarning: true,
            message: `Ya existe(n) servicio(s) con nombre similar a "${params.name}". Pregunta al usuario si quiere crearlo de todas formas (reintenta con force: true), actualizar el existente, o cancelar.`,
            existingServices: similar.map((s) => ({
              id: s._id,
              name: s.name,
              duration: s.duration,
              price: s.price,
            })),
          };
        }
      }

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
