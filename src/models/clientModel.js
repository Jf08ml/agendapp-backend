import mongoose from "mongoose";

const clientSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: false,
      // unique: true,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    // 🌍 Campos internacionales
    phone_e164: {
      type: String,
      required: false, // Se poblará progresivamente
      index: true,
    },
    phone_country: {
      type: String,
      required: false, // ISO2: CO, MX, PE, etc.
      maxlength: 2,
    },
    servicesTaken: {
      type: Number,
      default: 0,
    },
    referralsMade: {
      type: Number,
      default: 0,
    },
    hasServiceDiscount: {
      type: Boolean,
      default: false,
    },
    serviceDiscountDetails: {
      type: String,
      default: "",
    },
    hasReferralBenefit: {
      type: Boolean,
      default: false,
    },
    referralBenefitDetails: {
      type: String,
      default: "",
    },
    // 🏆 Historial de recompensas ganadas
    rewardHistory: {
      type: [
        {
          type: { type: String, enum: ["service", "referral"], required: true },
          reward: { type: String, required: true },
          earnedAt: { type: Date, default: Date.now },
          redeemed: { type: Boolean, default: false },
          redeemedAt: { type: Date },
        },
      ],
      default: [],
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    birthDate: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

// 🔒 Índice compuesto único: previene duplicados de phone_e164 por organización
// Solo aplica a documentos donde phone_e164 existe y es string (ignora null/undefined)
clientSchema.index(
  { phone_e164: 1, organizationId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      phone_e164: { $exists: true, $type: 'string' }
    },
    name: 'unique_phone_per_organization'
  }
);

// Método para incrementar los servicios tomados
// Recibe los umbrales configurados por la organización
clientSchema.methods.incrementServices = async function (serviceCount = 7, serviceReward = "Descuento especial por servicios") {
  this.servicesTaken += 1;

  let rewardEarned = false;
  let rewardDetails = "";

  if (this.servicesTaken >= serviceCount) {
    rewardDetails = serviceReward || "Descuento especial por servicios";
    this.hasServiceDiscount = true;
    this.serviceDiscountDetails = rewardDetails;
    this.rewardHistory.push({
      type: "service",
      reward: rewardDetails,
      earnedAt: new Date(),
    });
    this.servicesTaken = 0; // Reiniciar el conteo a 0 para el próximo ciclo
    rewardEarned = true;
  } else {
    this.hasServiceDiscount = false;
    this.serviceDiscountDetails = "";
  }

  await this.save();
  return { rewardEarned, rewardDetails };
};

// Método para incrementar los referidos realizados
// Recibe los umbrales configurados por la organización
clientSchema.methods.incrementReferrals = async function (referredCount = 5, referredReward = "Beneficio especial por referidos", serviceCount = 7, serviceReward = "Descuento especial por servicios") {
  this.referralsMade += 1;
  this.servicesTaken += 1; // Cada referido cuenta también como un servicio

  let referralRewardEarned = false;
  let referralRewardDetails = "";
  let serviceRewardEarned = false;
  let serviceRewardDetails = "";

  // Verificar umbral de referidos
  if (this.referralsMade >= referredCount) {
    referralRewardDetails = referredReward || "Beneficio especial por referidos";
    this.hasReferralBenefit = true;
    this.referralBenefitDetails = referralRewardDetails;
    this.rewardHistory.push({
      type: "referral",
      reward: referralRewardDetails,
      earnedAt: new Date(),
    });
    this.referralsMade = 0; // Reiniciar conteo a 0
    referralRewardEarned = true;
  } else {
    this.hasReferralBenefit = false;
    this.referralBenefitDetails = "";
  }

  // También revisar si los servicios tomados alcanzan el umbral configurado
  if (this.servicesTaken >= serviceCount) {
    serviceRewardDetails = serviceReward || "Descuento especial por servicios";
    this.hasServiceDiscount = true;
    this.serviceDiscountDetails = serviceRewardDetails;
    this.rewardHistory.push({
      type: "service",
      reward: serviceRewardDetails,
      earnedAt: new Date(),
    });
    this.servicesTaken = 0;
    serviceRewardEarned = true;
  } else {
    this.hasServiceDiscount = false;
    this.serviceDiscountDetails = "";
  }

  await this.save();
  return { referralRewardEarned, referralRewardDetails, serviceRewardEarned, serviceRewardDetails };
};

const Client = mongoose.model("Client", clientSchema);

export default Client;
