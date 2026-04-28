import mongoose from "mongoose";
import Service from "../../models/serviceModel.js";
import Employee from "../../models/employeeModel.js";

// Resuelve un serviceId: acepta ObjectId válido o nombre parcial del servicio.
async function resolveServiceId(value, organizationId) {
  if (mongoose.Types.ObjectId.isValid(value)) return value;
  // Intenta buscar por nombre (case-insensitive, coincidencia parcial)
  const found = await Service.findOne({
    organizationId,
    name: { $regex: value.replace(/-/g, " "), $options: "i" },
    isActive: true,
  }).lean();
  if (found) return found._id.toString();
  return null;
}

// Resuelve un employeeId: acepta ObjectId válido o nombre parcial.
async function resolveEmployeeId(value, organizationId) {
  if (!value) return null;
  if (mongoose.Types.ObjectId.isValid(value)) return value;
  const found = await Employee.findOne({
    organizationId,
    names: { $regex: value.replace(/-/g, " "), $options: "i" },
    isActive: true,
  }).lean();
  return found ? found._id.toString() : null;
}

// Esta tool no crea la reserva directamente — prepara el payload para que el
// frontend lo confirme y llame al endpoint /api/reservations/multi existente.
export const prepareReservation = {
  name: "prepare_reservation",
  description:
    "Llama esto cuando tengas TODA la información necesaria y el usuario haya dicho que sí al resumen. Prepara el payload final para que el frontend cree la reserva al hacer clic en el botón de confirmación.",
  parameters: {
    services: {
      type: "array",
      description:
        "Array de servicios. Cada item debe tener serviceId (usa SIEMPRE el campo 'id' que devolvió get_services, no el nombre) y employeeId (null si no aplica).",
      items: { type: "object" },
      required: true,
    },
    startDate: {
      type: "string",
      description:
        "Fecha y hora de inicio en formato YYYY-MM-DDTHH:mm:ss (usa el campo isoString que devolvió get_available_slots)",
      required: true,
    },
    customerName: {
      type: "string",
      description: "Nombre completo del cliente",
      required: true,
    },
    customerPhone: {
      type: "string",
      description: "Teléfono del cliente",
      required: false,
    },
    customerEmail: {
      type: "string",
      description: "Email del cliente",
      required: false,
    },
    customerDocumentId: {
      type: "string",
      description: "Número de documento del cliente",
      required: false,
    },
    notes: {
      type: "string",
      description: "Notas adicionales (opcional)",
      required: false,
    },
  },
  handler: async (params, { organizationId }) => {
    const {
      services,
      startDate,
      customerName,
      customerPhone,
      customerEmail,
      customerDocumentId,
      notes,
    } = params;

    if (!services?.length || !startDate || !customerName) {
      return { success: false, error: "Faltan datos requeridos para la reserva." };
    }

    // Resolver IDs (el AI a veces usa nombres en lugar de ObjectIds)
    const resolvedServices = [];
    for (const s of services) {
      const serviceId = await resolveServiceId(s.serviceId, organizationId);
      if (!serviceId) {
        return { success: false, error: `No se encontró el servicio: ${s.serviceId}. Usa el campo 'id' exacto que devolvió get_services.` };
      }
      const employeeId = await resolveEmployeeId(s.employeeId, organizationId);
      resolvedServices.push({ serviceId, employeeId });
    }

    const payload = {
      services: resolvedServices,
      startDate,
      customerDetails: {
        name: customerName,
        phone: customerPhone || "",
        email: customerEmail || "",
        documentId: customerDocumentId || "",
        notes: notes || "",
        birthDate: null,
      },
      organizationId: organizationId.toString(),
    };

    return {
      success: true,
      payload,
      _instruction:
        "PAYLOAD LISTO. La reserva NO ha sido creada todavía. El frontend mostrará un botón al cliente. NO digas que la reserva fue creada, confirmada ni procesada. Di ÚNICAMENTE que el botón de confirmación ya está listo para que el cliente haga clic.",
    };
  },
};
