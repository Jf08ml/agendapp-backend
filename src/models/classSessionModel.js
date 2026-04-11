import { Schema, Types, model } from "mongoose";

const classSessionSchema = new Schema(
  {
    classId: { type: Types.ObjectId, ref: "Class", required: true },
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true },
    employeeId: { type: Types.ObjectId, ref: "Employee", required: true },
    roomId: { type: Types.ObjectId, ref: "Room", required: true },
    // Fechas en UTC (igual que Appointment)
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    // Cupo de esta sesión (puede diferir del defaultCapacity de la clase)
    capacity: { type: Number, required: true, min: 1 },
    // Contador atómico de inscritos confirmados
    enrolledCount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["open", "full", "cancelled", "completed"],
      default: "open",
    },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

// Índices para consultas de disponibilidad
classSessionSchema.index({ organizationId: 1, startDate: 1 });
classSessionSchema.index({ classId: 1, startDate: 1 });
classSessionSchema.index({ employeeId: 1, startDate: 1, endDate: 1 });
classSessionSchema.index({ roomId: 1, startDate: 1, endDate: 1 });

export default model("ClassSession", classSessionSchema);
