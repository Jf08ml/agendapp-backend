import Plan from "../models/planModel.js";

const planService = {
  // Crear un nuevo plan
  createPlan: async (planData) => {
    const {
      name,
      slug,
      displayName,
      price,
      billingCycle,
      characteristics,
      domainType,
      limits,
      description,
    } = planData;

    const newPlan = new Plan({
      name,
      slug: slug || name.toLowerCase().replace(/\s+/g, "-"),
      displayName: displayName || name,
      price,
      billingCycle: billingCycle || "monthly",
      characteristics,
      domainType,
      limits,
      description,
    });

    return await newPlan.save();
  },

  // Obtener todos los planes
  getPlans: async () => {
    return await Plan.find({ isActive: true });
  },

  // Obtener todos los planes incluyendo inactivos (admin)
  getAllPlans: async () => {
    return await Plan.find();
  },

  // Obtener un plan por ID
  getPlanById: async (id) => {
    const plan = await Plan.findById(id);
    if (!plan) {
      throw new Error("Plan no encontrado");
    }
    return plan;
  },

  // Actualizar un plan
  updatePlan: async (id, updatedData) => {
    const plan = await Plan.findById(id);

    if (!plan) {
      throw new Error("Plan no encontrado");
    }

    plan.set(updatedData);
    return await plan.save();
  },

  // Eliminar un plan
  deletePlan: async (id) => {
    const plan = await Plan.findById(id);
    if (!plan) {
      throw new Error("Plan no encontrado");
    }

    return await plan.deleteOne();
  },
};

export default planService;
