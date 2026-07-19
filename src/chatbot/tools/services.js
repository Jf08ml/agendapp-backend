import Service from "../../models/serviceModel.js";
import Organization from "../../models/organizationModel.js";
import { getVerticalCatalog } from "../../utils/verticalCatalogs.js";

// Monedas sin decimales (denominación grande): sus precios típicos van ×1000
// respecto a la base del catálogo (ej: $40 USD ≈ $40.000 COP).
const LARGE_DENOMINATION_CURRENCIES = new Set([
  "COP", "CLP", "CRC", "PYG", "ARS", "HUF", "KRW", "IDR", "VND", "UYU", "NIO",
]);

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
      "Crea un nuevo servicio para la organización. Úsalo cuando el usuario quiera añadir un servicio (corte, masaje, consulta, etc.). Si ya existe un servicio con nombre muy similar, devuelve duplicateWarning — pregunta al usuario y reintenta con force: true solo si confirma. Si el precio parece desproporcionado, devuelve priceWarning — confirma el monto con el usuario y reintenta con el precio corregido (o force: true si el precio es correcto).",
    parameters: {
      name: { type: "string", description: "Nombre del servicio", required: true },
      type: { type: "string", description: "Categoría o tipo del servicio (ej: Corte, Masaje, Consulta, Tratamiento). Si el usuario no lo menciona, infiere uno apropiado según el nombre.", required: true },
      duration: { type: "number", description: "Duración en minutos (ej: 30, 45, 60)", required: true },
      price: { type: "number", description: "Precio del servicio en la moneda local. Interpreta 'mil'/'k' como 1.000 y 'millón' como 1.000.000 (ej: '60 mil' = 60000, NO 60000000).", required: true },
      description: { type: "string", description: "Descripción breve del servicio para mostrársela al cliente (opcional)", required: false },
      recommendations: { type: "string", description: "Recomendaciones o instrucciones para el cliente antes de la cita (ej: 'Llegar sin maquillaje', 'No consumir cafeína 2h antes'). Opcional.", required: false },
      maxConcurrentAppointments: { type: "number", description: "Número de clientes que pueden ser atendidos simultáneamente por un profesional para este servicio. Por defecto 1. Útil para clases grupales o consultas múltiples.", required: false },
      featured: { type: "boolean", description: "Marcar como servicio destacado (⭐): se muestra de primero en la página pública, el wizard de reserva y el chatbot de reservas. Úsalo solo si el usuario lo pide explícitamente.", required: false },
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
      // Sanity-check de precio: evita errores de magnitud ("60 mil" → 60.000.000).
      // Compara contra el precio típico del rubro; si lo supera ~25× es casi seguro
      // un error de 1000× (mil vs millón). El usuario puede forzar con force: true.
      if (!params.force && Number(params.price) > 0) {
        const org = await Organization.findById(context.organizationId).select("businessVertical currency");
        const catalog = getVerticalCatalog(org?.businessVertical);
        const mult = LARGE_DENOMINATION_CURRENCIES.has(String(org?.currency || "").toUpperCase()) ? 1000 : 1;
        const typicalMax = Math.max(0, ...catalog.services.map((s) => Number(s.price) || 0)) * mult;
        if (typicalMax > 0 && Number(params.price) > typicalMax * 25) {
          const suggested = Math.round(Number(params.price) / 1000);
          return {
            success: false,
            priceWarning: true,
            message: `El precio ingresado ($${Number(params.price).toLocaleString("es-CO")}) parece desproporcionado para este rubro (lo típico ronda $${typicalMax.toLocaleString("es-CO")} o menos). Probable error de magnitud (¿quisiste decir $${suggested.toLocaleString("es-CO")}?). Confirma el monto correcto con el usuario y reintenta con el precio corregido; usa force: true SOLO si el usuario confirma que el precio realmente es ese.`,
            suggestedPrice: suggested,
          };
        }
      }

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
        featured: params.featured === true,
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
          featured: service.featured,
        },
      };
    },
  },
  {
    name: "get_services",
    description: "Obtiene la lista de servicios configurados en la organización (destacados primero).",
    parameters: {},
    handler: async (_params, context) => {
      const services = await Service.find({ organizationId: context.organizationId, isActive: true })
        .select("name duration price description maxConcurrentAppointments featured")
        .sort({ _id: 1 });
      // Sort estable en JS: en BSON el campo ausente ordena distinto que false explícito
      services.sort((a, b) => (b.featured === true ? 1 : 0) - (a.featured === true ? 1 : 0));
      return {
        success: true,
        services: services.map((s) => ({
          id: s._id,
          name: s.name,
          duration: s.duration,
          price: s.price,
          maxConcurrentAppointments: s.maxConcurrentAppointments,
          featured: s.featured === true,
        })),
      };
    },
  },
  {
    name: "bulk_create_services",
    description:
      "Crea VARIOS servicios en una sola llamada. Úsala SIEMPRE que el usuario pegue o dicte una lista de 2 o más servicios de una sola vez (por ejemplo, copiando su catálogo completo durante el onboarding) — NUNCA llames create_service uno por uno en ese caso, es mucho más lento y costoso. Aplica el mismo chequeo de duplicados y de precio desproporcionado que create_service, item por item, sin bloquear el resto del lote.",
    parameters: {
      services: {
        type: "array",
        description:
          "Lista de servicios a crear. Cada item: { name, type, duration, price, description?, recommendations? }. 'type' es la categoría — infiere una apropiada si el usuario no la da. 'price' se interpreta igual que en create_service ('60 mil' = 60000, no 60000000).",
        required: true,
        items: { type: "object" },
      },
      force: {
        type: "boolean",
        description:
          "Crear igual los servicios que salgan marcados como posible duplicado o precio sospechoso. Úsalo SOLO reenviando esos items puntuales después de que el usuario confirme explícitamente.",
        required: false,
      },
    },
    handler: async (params, context) => {
      const { services, force } = params;
      if (!Array.isArray(services) || services.length === 0) {
        return { success: false, error: "No se recibió ninguna lista de servicios para crear." };
      }

      const org = await Organization.findById(context.organizationId).select("businessVertical currency");
      const catalog = getVerticalCatalog(org?.businessVertical);
      const mult = LARGE_DENOMINATION_CURRENCIES.has(String(org?.currency || "").toUpperCase()) ? 1000 : 1;
      const typicalMax = Math.max(0, ...catalog.services.map((s) => Number(s.price) || 0)) * mult;

      const existing = await Service.find({ organizationId: context.organizationId, isActive: true }).select("name");
      // Índice mutable: se actualiza dentro del loop para detectar duplicados entre
      // items del mismo lote (ej. el usuario repite un servicio dos veces en su lista).
      const knownNorms = existing.map((s) => ({ id: s._id, name: s.name, norm: normalizeForCompare(s.name) }));

      const created = [];
      const skippedDuplicates = [];
      const priceWarnings = [];
      const failed = [];

      for (const item of services) {
        try {
          if (!item?.name || !item?.duration || item?.price == null) {
            failed.push({ name: item?.name || "(sin nombre)", error: "Faltan campos obligatorios: name, duration y price." });
            continue;
          }

          if (!force && typicalMax > 0 && Number(item.price) > typicalMax * 25) {
            priceWarnings.push({ name: item.name, price: item.price, suggestedPrice: Math.round(Number(item.price) / 1000) });
            continue;
          }

          if (!force) {
            const newNorm = normalizeForCompare(item.name);
            const similar = knownNorms.filter(({ norm }) => norm === newNorm || norm.includes(newNorm) || newNorm.includes(norm));
            if (similar.length > 0) {
              skippedDuplicates.push({ name: item.name, existingServices: similar.map((s) => ({ id: s.id, name: s.name })) });
              continue;
            }
          }

          const doc = await Service.create({
            name: item.name,
            type: item.type || "General",
            duration: item.duration,
            price: item.price,
            description: item.description || "",
            recommendations: item.recommendations || null,
            maxConcurrentAppointments: item.maxConcurrentAppointments ?? 1,
            costs: Array.isArray(item.costs) ? item.costs : [],
            featured: item.featured === true,
            organizationId: context.organizationId,
          });
          knownNorms.push({ id: doc._id, name: doc.name, norm: normalizeForCompare(doc.name) });
          created.push({ id: doc._id, name: doc.name, duration: doc.duration, price: doc.price });
        } catch (err) {
          failed.push({ name: item?.name || "(sin nombre)", error: err.message });
        }
      }

      return {
        success: true,
        createdCount: created.length,
        created,
        skippedDuplicates,
        priceWarnings,
        failed,
        _instruction:
          skippedDuplicates.length > 0 || priceWarnings.length > 0
            ? "Dile al usuario cuántos servicios se crearon. Para los de skippedDuplicates y priceWarnings, muéstraselos puntualmente y pregunta si quiere crearlos igual — si confirma, reintenta bulk_create_services SOLO con esos items y force: true. No repitas la lista completa del lote."
            : "Confirma al usuario cuántos servicios se crearon exitosamente, con un resumen breve (no hace falta listar los 50 uno por uno si son muchos).",
      };
    },
  },
];
