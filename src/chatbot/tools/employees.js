import Employee from "../../models/employeeModel.js";
import Service from "../../models/serviceModel.js";
import bcrypt from "bcryptjs";

const generateTempPassword = () => Math.random().toString(36).slice(-8) + "A1!";

export default [
  {
    name: "create_employee",
    description:
      "Crea un nuevo profesional/empleado en la organización. Úsalo cuando el usuario quiera registrar a un trabajador (peluquero, médico, instructor, etc.).",
    parameters: {
      names: { type: "string", description: "Nombre completo del profesional", required: true },
      position: { type: "string", description: "Cargo o especialidad (ej: Peluquero, Médico, Instructor)", required: true },
      email: { type: "string", description: "Correo electrónico del profesional (será su usuario de acceso)", required: true },
      phoneNumber: { type: "string", description: "Número de teléfono (con código de país, ej: +573001234567)", required: true },
      commissionType: { type: "string", description: "Tipo de comisión: 'percentage' (porcentaje del valor de la cita) o 'fixed' (monto fijo por cita). Por defecto 'percentage'.", required: false },
      commissionValue: { type: "number", description: "Valor de la comisión. Si es porcentaje, ingresa el número (ej: 40 para 40%). Si es fijo, el monto exacto por cita. Por defecto 0.", required: false },
    },
    handler: async (params, context) => {
      const tempPassword = generateTempPassword();
      const hashed = await bcrypt.hash(tempPassword, 10);

      const employee = await Employee.create({
        names: params.names,
        position: params.position,
        email: params.email.toLowerCase().trim(),
        phoneNumber: params.phoneNumber,
        password: hashed,
        commissionType: params.commissionType || "percentage",
        commissionValue: params.commissionValue ?? 0,
        organizationId: context.organizationId,
      });

      return {
        success: true,
        employee: { id: employee._id, names: employee.names, position: employee.position, email: employee.email },
        tempPassword,
        note: `Contraseña temporal generada: ${tempPassword} — compártela con el profesional para que pueda iniciar sesión y cambiarla.`,
      };
    },
  },
  {
    name: "get_employees",
    description: "Obtiene la lista de profesionales/empleados de la organización.",
    parameters: {},
    handler: async (_params, context) => {
      const employees = await Employee.find({ organizationId: context.organizationId, isActive: true }).select("names position email");
      return { success: true, employees: employees.map((e) => ({ id: e._id, names: e.names, position: e.position, email: e.email })) };
    },
  },
  {
    name: "assign_services_to_employee",
    description: "Asigna servicios a un profesional. El profesional solo podrá atender los servicios asignados.",
    parameters: {
      employeeId: { type: "string", description: "ID del profesional", required: true },
      serviceNames: { type: "array", description: "Lista de nombres de servicios a asignar", required: true, items: { type: "string" } },
    },
    handler: async (params, context) => {
      const services = await Service.find({
        organizationId: context.organizationId,
        name: { $in: params.serviceNames },
        isActive: true,
      }).select("_id name");

      await Employee.findByIdAndUpdate(params.employeeId, { $addToSet: { services: { $each: services.map((s) => s._id) } } });

      return { success: true, assigned: services.map((s) => s.name) };
    },
  },
];
