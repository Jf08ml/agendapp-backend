import mongoose from "mongoose";

const packageServiceSchema = new mongoose.Schema({
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Service",
    required: true,
  },
  sessionsIncluded: {
    type: Number,
    required: true,
    min: 1,
  },
});

// 📚 Clases incluidas en el paquete (créditos por clase específica)
const packageClassSchema = new mongoose.Schema({
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Class",
    required: true,
  },
  sessionsIncluded: {
    type: Number,
    required: true,
    min: 1,
  },
});

const servicePackageSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: "",
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    services: {
      type: [packageServiceSchema],
      default: [],
    },
    // 📚 Clases incluidas (créditos por clase específica)
    classes: {
      type: [packageClassSchema],
      default: [],
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    validityDays: {
      type: Number,
      required: true,
      min: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

servicePackageSchema.index({ organizationId: 1, isActive: 1 });

// El paquete debe incluir al menos un ítem (servicio o clase)
servicePackageSchema.pre("validate", function (next) {
  const totalItems = (this.services?.length || 0) + (this.classes?.length || 0);
  if (totalItems < 1) {
    return next(new Error("El paquete debe incluir al menos un servicio o una clase"));
  }
  next();
});

export default mongoose.model("ServicePackage", servicePackageSchema);
