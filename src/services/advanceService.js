import advancesModel from "../models/advancesModel.js";
import Employee from "../models/employeeModel.js";

const advanceService = {
  // Crear un nuevo avance (o ingreso manual, según `type`), acotado a la organización
  createAdvance: async (organizationId, advanceData) => {
    const { employee, type, description, amount, date } = advanceData;

    const employeeDoc = await Employee.findOne({ _id: employee, organizationId });
    if (!employeeDoc) {
      throw new Error("Profesional no encontrado en esta organización");
    }

    const newAdvance = new advancesModel({
      organizationId,
      employee,
      type: type || "advance",
      description,
      amount,
      date,
    });

    return await newAdvance.save();
  },

  // Obtener avances (o ingresos) de un empleado, acotado a la organización
  getAdvancesByEmployee: async (organizationId, employeeId) => {
    return await advancesModel
      .find({ employee: employeeId, organizationId })
      .populate("employee")
      .exec();
  },

  // Actualizar un avance/ingreso (solo si pertenece a la organización)
  updateAdvance: async (organizationId, id, updatedData) => {
    const advance = await advancesModel.findOne({ _id: id, organizationId });
    if (!advance) {
      throw new Error("Avance no encontrado");
    }

    // organizationId nunca se sobreescribe desde el body del request
    const { organizationId: _ignored, ...safeData } = updatedData;
    advance.set(safeData);
    return await advance.save();
  },

  // Eliminar un avance/ingreso (solo si pertenece a la organización)
  deleteAdvance: async (organizationId, id) => {
    const advance = await advancesModel.findOneAndDelete({ _id: id, organizationId });
    if (!advance) {
      throw new Error("Avance no encontrado");
    }
    return advance;
  },
};

export default advanceService;
