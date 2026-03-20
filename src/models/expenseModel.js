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
    registeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: false,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Expense", expenseSchema);
