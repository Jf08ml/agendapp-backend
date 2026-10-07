import mongoose from "mongoose";
import Employee from "../../models/employeeModel.js";
import Service from "../../models/serviceModel.js";

// Quita acentos, emojis y signos para comparar nombres de servicio de forma flexible
// ("Corte Tradicional" debe encontrar "✂️ Corte Tradicional ✨").
const normalizeForSearch = (str) =>
  String(str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Acepta el id exacto o el nombre del servicio. Antes solo aceptaba el id: si el
// modelo pasaba el nombre, la consulta fallaba y el modelo inventaba profesionales
// (casos reales sep-2026: "Jhon, Leider, Daniel" en Bastidas Barber; "Jessica,
// Laura, Valeria" en Cata Cruz Nails).
async function resolveServiceId(value, organizationId) {
  if (!value) return null;
  if (mongoose.Types.ObjectId.isValid(value)) {
    const byId = await Service.findOne({ _id: value, organizationId }).select("_id").lean();
    if (byId) return byId._id;
  }
  const queryWords = normalizeForSearch(value).split(" ").filter(Boolean);
  if (queryWords.length === 0) return null;
  const services = await Service.find({ organizationId, isActive: true }).select("_id name").lean();
  const matches = services.filter((s) => {
    const normName = normalizeForSearch(s.name);
    return queryWords.every((w) => normName.includes(w));
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.name.length - b.name.length);
  return matches[0]._id;
}

export const getEmployeesForService = {
  name: "get_employees_for_service",
  description:
    "Obtiene los profesionales activos que pueden atender un servicio específico. Devuelve la ÚNICA lista válida de profesionales para ese servicio.",
  parameters: {
    serviceId: {
      type: "string",
      description: "Campo 'id' del servicio devuelto por get_services (si no lo tienes, el nombre exacto del servicio).",
      required: true,
    },
  },
  handler: async ({ serviceId }, { organizationId }) => {
    const resolvedId = await resolveServiceId(serviceId, organizationId);
    if (!resolvedId) {
      return {
        success: false,
        error: `No se encontró el servicio "${serviceId}".`,
        _instruction:
          "Vuelve a llamar get_employees_for_service con el campo 'id' exacto que devolvió get_services. NO inventes nombres de profesionales.",
      };
    }

    const employees = await Employee.find({
      organizationId,
      isActive: true,
      services: resolvedId,
    })
      .select("_id names position")
      .lean();

    if (employees.length === 0) {
      return {
        success: true,
        employees: [],
        _instruction:
          "Ningún profesional activo atiende este servicio, así que no se puede reservar en línea. NO inventes nombres. Díselo al cliente con amabilidad y ofrécele elegir otro servicio o el contacto del negocio (get_organization_info).",
      };
    }

    return {
      success: true,
      employees: employees.map((e) => ({
        id: e._id.toString(),
        name: e.names,
        position: e.position || "",
      })),
      _instruction:
        "Estos son los ÚNICOS profesionales que atienden este servicio. Nunca menciones otros nombres. Si el cliente pide a alguien que no está en esta lista, dile que esa persona no atiende este servicio y ofrécele los de la lista.",
    };
  },
};
