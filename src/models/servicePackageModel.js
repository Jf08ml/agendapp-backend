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
      validate: {
        validator: function (arr) {
          return arr.length > 0;
        },
        message: "El paquete debe incluir al menos un servicio",
      },
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

export default mongoose.model("ServicePackage", servicePackageSchema);
