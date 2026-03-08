import Expense from "../models/expenseModel.js";
import sendResponse from "../utils/sendResponse.js";

const expenseController = {
  // Crear gasto general
  createExpense: async (req, res) => {
    try {
      if (!req.organization) return sendResponse(res, 400, null, "Organización no identificada");
      const { concept, amount, category, date } = req.body;
      const expense = await Expense.create({
        organizationId: req.organization._id,
        concept,
        amount,
        category: category || "",
        date: date || new Date(),
      });
      sendResponse(res, 201, expense, "Gasto registrado exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Obtener gastos por rango de fechas
  getExpenses: async (req, res) => {
    try {
      if (!req.organization) return sendResponse(res, 400, null, "Organización no identificada");
      const { startDate, endDate } = req.query;

      const filter = { organizationId: req.organization._id };
      if (startDate || endDate) {
        filter.date = {};
        if (startDate) filter.date.$gte = new Date(startDate);
        if (endDate) filter.date.$lte = new Date(endDate);
      }

      const expenses = await Expense.find(filter).sort({ date: -1 });
      sendResponse(res, 200, expenses, "Gastos obtenidos exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Eliminar gasto
  deleteExpense: async (req, res) => {
    try {
      if (!req.organization) return sendResponse(res, 400, null, "Organización no identificada");
      const organizationId = req.organization._id;
      const expense = await Expense.findOneAndDelete({
        _id: req.params.id,
        organizationId,
      });
      if (!expense) return sendResponse(res, 404, null, "Gasto no encontrado");
      sendResponse(res, 200, null, "Gasto eliminado exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Actualizar gasto
  updateExpense: async (req, res) => {
    try {
      if (!req.organization) return sendResponse(res, 400, null, "Organización no identificada");
      const organizationId = req.organization._id;
      const expense = await Expense.findOneAndUpdate(
        { _id: req.params.id, organizationId },
        req.body,
        { new: true }
      );
      if (!expense) return sendResponse(res, 404, null, "Gasto no encontrado");
      sendResponse(res, 200, expense, "Gasto actualizado exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },
};

export default expenseController;
