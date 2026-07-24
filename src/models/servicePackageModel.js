import mongoose from "mongoose";

const packageServiceSchema = new mongoose.Schema({
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Service",
    required: true,
  },
  // Obligatorio solo en paquetes SIN niveles (ver validación más abajo) —
  // en paquetes con niveles, las sesiones las define cada tier.
  sessionsIncluded: {
    type: Number,
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
    min: 1,
  },
});

// 🎚️ Nivel/variante de un mismo paquete (ej: "x4", "x8", "x12") — mismo
// servicio/clase base, distinta cantidad de sesiones y precio. Las sesiones
// de cada nivel aplican de forma uniforme a TODOS los servicios/clases
// incluidos en el paquete.
const packageTierSchema = new mongoose.Schema({
  label: {
    type: String,
    required: true,
    trim: true,
  },
  sessionsIncluded: {
    type: Number,
    required: true,
    min: 1,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  // Sesiones de cortesía: se suman a sessionsIncluded (no se cobran, pero
  // el cliente las recibe igual). Puramente informativo en ClientPackage —
  // una vez asignadas, se consumen igual que cualquier otra sesión.
  courtesySessions: {
    type: Number,
    default: 0,
    min: 0,
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
    // Obligatorio solo en paquetes SIN niveles — con niveles, cada tier trae
    // su propio precio.
    price: {
      type: Number,
      min: 0,
    },
    // Niveles/variantes del mismo paquete (ej: x4/x8/x12). Vacío = paquete
    // "simple" (comportamiento de siempre: un solo precio y sesiones fijas
    // por servicio/clase). Con niveles, el admin/cliente elige uno al
    // asignar/comprar.
    tiers: {
      type: [packageTierSchema],
      default: [],
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

servicePackageSchema.pre("validate", function (next) {
  const totalItems = (this.services?.length || 0) + (this.classes?.length || 0);
  if (totalItems < 1) {
    return next(new Error("El paquete debe incluir al menos un servicio o una clase"));
  }

  const isTiered = (this.tiers?.length || 0) > 0;

  if (isTiered) {
    const invalidTier = this.tiers.some(
      (t) => !t.label?.trim() || t.sessionsIncluded == null || t.price == null
    );
    if (invalidTier) {
      return next(new Error("Cada nivel debe tener etiqueta, sesiones incluidas y precio."));
    }
  } else {
    if (this.price == null) {
      return next(new Error("El precio es obligatorio en un paquete sin niveles."));
    }
    const missingSessions =
      this.services?.some((s) => s.sessionsIncluded == null) ||
      this.classes?.some((c) => c.sessionsIncluded == null);
    if (missingSessions) {
      return next(new Error("Cada servicio/clase debe indicar sus sesiones incluidas."));
    }
  }

  next();
});

export default mongoose.model("ServicePackage", servicePackageSchema);
