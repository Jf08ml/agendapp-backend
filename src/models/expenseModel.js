import mongoose from "mongoose";

const expenseSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
    },
    concept: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: String,
      default: "",
      trim: true,
    },
    type: {
      type: String,
      enum: ["expense", "income"],
      default: "expense",
    },
    // Método de pago del movimiento. Default null a propósito:
    // los movimientos históricos sin método NO deben contar como efectivo.
    method: {
      type: String,
      enum: ["cash", "card", "transfer", "other", null],
      default: null,
    },
    registeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: false,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Expense", expenseSchema);
