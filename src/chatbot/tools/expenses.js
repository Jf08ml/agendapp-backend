import Expense from "../../models/expenseModel.js";
import moment from "moment-timezone";

const METHOD_MAP = {
  efectivo: "cash", cash: "cash", contado: "cash",
  tarjeta: "card", card: "card",
  transferencia: "transfer", transfer: "transfer", nequi: "transfer", daviplata: "transfer",
};

export default [
  {
    name: "register_expense",
    description:
      "Registra un gasto general del negocio (no ligado a una cita específica) — ej. arriendo, servicios públicos, compra de insumos. Úsala cuando el usuario diga que pagó o gastó dinero en algo del negocio.",
    parameters: {
      concept: { type: "string", description: "Concepto o descripción del gasto (ej: 'Arriendo local', 'Compra de toallas').", required: true },
      amount: { type: "number", description: "Monto del gasto.", required: true },
      category: { type: "string", description: "Categoría del gasto (opcional, ej: 'Arriendo', 'Insumos', 'Servicios').", required: false },
      method: { type: "string", description: "Método de pago del gasto: 'efectivo', 'tarjeta' o 'transferencia' (opcional).", required: false },
      date: { type: "string", description: "Fecha del gasto en formato YYYY-MM-DD. Por defecto hoy.", required: false },
    },
    handler: async (params, context) => {
      if (!params.amount || Number(params.amount) <= 0) {
        return { success: false, error: "El monto del gasto debe ser mayor a 0." };
      }
      const tz = context.organization.timezone || "America/Bogota";
      const date = params.date ? moment.tz(params.date, "YYYY-MM-DD", tz).toDate() : moment.tz(tz).toDate();
      const method = params.method ? METHOD_MAP[params.method.toLowerCase().trim()] || null : null;

      const expense = await Expense.create({
        organizationId: context.organizationId,
        date,
        concept: params.concept,
        amount: Number(params.amount),
        category: params.category || undefined,
        type: "expense",
        method,
        registeredBy: context.user?.userId || undefined,
      });

      return {
        success: true,
        gasto: {
          id: expense._id,
          concepto: expense.concept,
          monto: expense.amount,
          fecha: moment(expense.date).tz(tz).format("DD/MM/YYYY"),
        },
      };
    },
  },
];
