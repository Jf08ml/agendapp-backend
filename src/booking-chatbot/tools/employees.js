import Employee from "../../models/employeeModel.js";

export const getEmployeesForService = {
  name: "get_employees_for_service",
  description:
    "Obtiene los profesionales activos que pueden atender un servicio específico.",
  parameters: {
    serviceId: {
      type: "string",
      description: "ID del servicio",
      required: true,
    },
  },
  handler: async ({ serviceId }, { organizationId }) => {
    const employees = await Employee.find({
      organizationId,
      isActive: true,
      services: serviceId,
    })
      .select("_id names position")
      .lean();

    return {
      employees: employees.map((e) => ({
        id: e._id.toString(),
        name: e.names,
        position: e.position || "",
      })),
    };
  },
};
