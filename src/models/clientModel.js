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
      required: false,
    },
    // 🌍 Campos internacionales
    phone_e164: {
      type: String,
      required: false,
      index: true,
    },
    phone_country: {
      type: String,
      required: false,
      maxlength: 2,
    },
    documentId: {
      type: String,
      required: false,
    },
    notes: {
      type: String,
      required: false,
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

// Índices de rendimiento (la unicidad se maneja a nivel de aplicación según identifierField)
clientSchema.index({ phone_e164: 1, organizationId: 1 }, { name: 'phone_per_organization' });
clientSchema.index({ documentId: 1, organizationId: 1 }, { name: 'documentId_per_organization' });
clientSchema.index({ email: 1, organizationId: 1 }, { name: 'email_per_organization' });

// Incrementa servicios tomados y evalúa los niveles (tiers) configurados.
// tiers: [{ threshold: Number, reward: String }]
// Al cruzar el umbral exacto de un nivel se otorga esa recompensa.
// Al alcanzar el nivel máximo el contador se reinicia a 0 (ciclo repetible).
clientSchema.methods.incrementServices = async function (tiers = []) {
  this.servicesTaken += 1;

  const sortedTiers = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const maxThreshold = sortedTiers[sortedTiers.length - 1]?.threshold ?? 0;
  const earnedRewards = [];

  for (const tier of sortedTiers) {
    if (this.servicesTaken === tier.threshold) {
      this.rewardHistory.push({ type: "service", reward: tier.reward, earnedAt: new Date() });
      earnedRewards.push(tier);
    }
  }

  const lastEarned = earnedRewards[earnedRewards.length - 1];
  if (lastEarned) {
    this.hasServiceDiscount = true;
    this.serviceDiscountDetails = lastEarned.reward;
  } else {
    this.hasServiceDiscount = false;
    this.serviceDiscountDetails = "";
  }

  if (maxThreshold > 0 && this.servicesTaken >= maxThreshold) {
    this.servicesTaken = 0;
  }

  await this.save();
  return { rewardEarned: earnedRewards.length > 0, earnedRewards };
};

// Incrementa referidos realizados y evalúa los niveles de referidos.
// Servicios y referidos son tracks completamente independientes.
clientSchema.methods.incrementReferrals = async function (tiers = []) {
  this.referralsMade += 1;

  const sortedTiers = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const maxThreshold = sortedTiers[sortedTiers.length - 1]?.threshold ?? 0;
  const earnedRewards = [];

  for (const tier of sortedTiers) {
    if (this.referralsMade === tier.threshold) {
      this.rewardHistory.push({ type: "referral", reward: tier.reward, earnedAt: new Date() });
      earnedRewards.push(tier);
    }
  }

  const lastEarned = earnedRewards[earnedRewards.length - 1];
  if (lastEarned) {
    this.hasReferralBenefit = true;
    this.referralBenefitDetails = lastEarned.reward;
  } else {
    this.hasReferralBenefit = false;
    this.referralBenefitDetails = "";
  }

  if (maxThreshold > 0 && this.referralsMade >= maxThreshold) {
    this.referralsMade = 0;
  }

  await this.save();
  return { rewardEarned: earnedRewards.length > 0, earnedRewards };
};

const Client = mongoose.model("Client", clientSchema);

export default Client;
