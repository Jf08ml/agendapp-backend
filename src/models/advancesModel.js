import mongoose from "mongoose";

const advanceModelSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true,
  },
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
    required: true,
  },
  // "advance" (adelanto, se resta de la nómina) | "income" (ingreso manual
  // de una cita realizada pero no registrada en el sistema, se suma)
  type: {
    type: String,
    enum: ["advance", "income"],
    default: "advance",
  },
  description: {
    type: String,
    required: true,
    default: "Avance de salario",
  },
  amount: {
    type: Number,
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
});

export default mongoose.model("Advance", advanceModelSchema);
