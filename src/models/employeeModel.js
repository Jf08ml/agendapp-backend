import mongoose from "mongoose";

// Schema para intervalos de descanso del empleado
const EmployeeBreakSchema = new mongoose.Schema(
  {
    start: { type: String, required: true }, // "12:00"
    end: { type: String, required: true }, // "13:00"
    note: { type: String },
  },
  { _id: false }
);

// Schema para horario de trabajo de un día específico del empleado
const EmployeeDayScheduleSchema = new mongoose.Schema(
  {
    day: { 
      type: Number, 
      min: 0, 
      max: 6, 
      required: true 
    }, // 0=Domingo, 1=Lunes, ..., 6=Sábado
    isAvailable: { 
      type: Boolean, 
      default: true 
    }, // Si está disponible ese día
    start: { 
      type: String, 
      required: function() { return this.isAvailable; }
    }, // "08:00"
    end: { 
      type: String, 
      required: function() { return this.isAvailable; }
    }, // "18:00"
    breaks: {
      type: [EmployeeBreakSchema],
      default: [],
    },
  },
  { _id: false }
);

const employeeModelSchema = new mongoose.Schema({
  names: { type: String, required: true },
  position: { type: String, required: true },
  services: [{ type: mongoose.Schema.Types.ObjectId, ref: "Service" }],
  email: { type: String, required: true },
  password: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true },
  role: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Role", 
    default: "67300292f3bc5c256d80e47d" 
  },
  customPermissions: [String],
  isActive: { type: Boolean, default: true },
  profileImage: { 
    type: String, 
    default: "https://ik.imagekit.io/6cx9tc1kx/default_smile.png?updatedAt=1732716506174"
  },
  color: { type: String },
  order: { type: Number, default: 0 },
  commissionPercentage: { type: Number, default: 0, min: 0, max: 100 },
  
  // NUEVO: Sistema de horarios de disponibilidad por día de la semana
  weeklySchedule: {
    enabled: { type: Boolean, default: false }, // Si está habilitado el horario semanal
    schedule: {
      type: [EmployeeDayScheduleSchema],
      default: function() {
        // Horario por defecto: Lunes a Viernes 8AM-6PM, fin de semana no disponible
        return [
          { day: 0, isAvailable: false }, // Domingo
          { day: 1, isAvailable: true, start: "08:00", end: "18:00", breaks: [] }, // Lunes
          { day: 2, isAvailable: true, start: "08:00", end: "18:00", breaks: [] }, // Martes
          { day: 3, isAvailable: true, start: "08:00", end: "18:00", breaks: [] }, // Miércoles
          { day: 4, isAvailable: true, start: "08:00", end: "18:00", breaks: [] }, // Jueves
          { day: 5, isAvailable: true, start: "08:00", end: "18:00", breaks: [] }, // Viernes
          { day: 6, isAvailable: false }, // Sábado
        ];
      },
    },
  },
});

// Aplicar índice único compuesto (email + organizationId)
employeeModelSchema.index({ email: 1, organizationId: 1 }, { unique: true });

export default mongoose.model("Employee", employeeModelSchema);
