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

// Auto-asigna el primer empleado activo que ofrece el servicio (fallback cuando el AI no especificó empleado).
async function autoAssignEmployee(serviceId, organizationId) {
  const found = await Employee.findOne({
    organizationId,
    isActive: true,
    services: serviceId,
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
        "Array de servicios. Cada item: { serviceId, employeeId }. REGLA CRÍTICA: serviceId SIEMPRE debe ser el campo 'id' exacto que devolvió get_services. employeeId SIEMPRE debe ser el campo 'id' exacto que devolvió get_employees_for_service — NUNCA el nombre. Solo usa null si el cliente no expresó preferencia de profesional en ningún momento de la conversación.",
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
    customerBirthDate: {
      type: "string",
      description: "Fecha de nacimiento del cliente en formato YYYY-MM-DD (opcional). Conviértela si el usuario la dio en otro formato.",
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
      customerBirthDate,
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
      let employeeId = await resolveEmployeeId(s.employeeId, organizationId);
      if (!employeeId) employeeId = await autoAssignEmployee(serviceId, organizationId);
      resolvedServices.push({ serviceId, employeeId });
    }

    // Validar y normalizar birthDate si se proporcionó
    let parsedBirthDate = null;
    if (customerBirthDate) {
      const d = new Date(customerBirthDate);
      if (!isNaN(d.getTime())) parsedBirthDate = d.toISOString();
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
        birthDate: parsedBirthDate,
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
