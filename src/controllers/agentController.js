import Agent from "../models/agentModel.js";
import Organization from "../models/organizationModel.js";
import sendResponse from "../utils/sendResponse.js";

const AGENT_TYPE_LABELS = {
  influencer: "Influencer",
  vendedor_externo: "Vendedor externo",
  vendedor_interno: "Vendedor interno",
  medio_comunicacion: "Medio de comunicación",
};

const generateCode = async () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (let i = 0; i < 5; i++) {
    const code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    const exists = await Agent.exists({ code });
    if (!exists) return code;
  }
  throw new Error("No se pudo generar un código único. Intenta de nuevo.");
};

const agentController = {
  /**
   * GET /admin/agents
   * Lista todos los agentes con conteos de referidos y conversiones.
   */
  listAgents: async (req, res) => {
    try {
      const agents = await Agent.find().sort({ createdAt: -1 }).lean();

      const agentIds = agents.map((a) => a._id);

      // Agregar referidos y conversiones en una sola pasada
      const stats = await Organization.aggregate([
        { $match: { referredByAgent: { $in: agentIds } } },
        {
          $group: {
            _id: "$referredByAgent",
            referralCount: { $sum: 1 },
            conversionCount: {
              $sum: { $cond: [{ $ne: ["$convertedToPayingAt", null] }, 1, 0] },
            },
          },
        },
      ]);

      const statsMap = Object.fromEntries(stats.map((s) => [s._id.toString(), s]));

      const result = agents.map((agent) => {
        const s = statsMap[agent._id.toString()] || { referralCount: 0, conversionCount: 0 };
        return { ...agent, referralCount: s.referralCount, conversionCount: s.conversionCount };
      });

      return sendResponse(res, 200, result);
    } catch (err) {
      console.error("[agentController.listAgents]", err.message);
      return sendResponse(res, 500, null, "Error al obtener agentes");
    }
  },

  /**
   * POST /admin/agents
   * Crear nuevo agente.
   */
  createAgent: async (req, res) => {
    try {
      const { name, email, phone, type, notes, code: customCode } = req.body;

      if (!name || !email || !type) {
        return sendResponse(res, 400, null, "Nombre, email y tipo son requeridos");
      }
      if (!Object.keys(AGENT_TYPE_LABELS).includes(type)) {
        return sendResponse(res, 400, null, "Tipo de agente inválido");
      }

      const code = customCode ? customCode.toUpperCase().trim() : await generateCode();

      const agent = new Agent({ name, email, phone: phone || null, type, code, notes: notes || null });
      await agent.save();

      return sendResponse(res, 201, agent, "Agente creado exitosamente");
    } catch (err) {
      if (err.code === 11000) {
        const field = Object.keys(err.keyPattern || {})[0];
        const msg = field === "email" ? "Ya existe un agente con ese email" : "Ese código ya está en uso";
        return sendResponse(res, 409, null, msg);
      }
      console.error("[agentController.createAgent]", err.message);
      return sendResponse(res, 500, null, "Error al crear agente");
    }
  },

  /**
   * PUT /admin/agents/:id
   * Editar agente.
   */
  updateAgent: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, email, phone, type, notes, status } = req.body;

      const agent = await Agent.findById(id);
      if (!agent) return sendResponse(res, 404, null, "Agente no encontrado");

      if (name !== undefined) agent.name = name;
      if (email !== undefined) agent.email = email;
      if (phone !== undefined) agent.phone = phone || null;
      if (type !== undefined) agent.type = type;
      if (notes !== undefined) agent.notes = notes || null;
      if (status !== undefined) agent.status = status;

      await agent.save();
      return sendResponse(res, 200, agent, "Agente actualizado");
    } catch (err) {
      if (err.code === 11000) {
        return sendResponse(res, 409, null, "Ya existe un agente con ese email");
      }
      console.error("[agentController.updateAgent]", err.message);
      return sendResponse(res, 500, null, "Error al actualizar agente");
    }
  },

  /**
   * DELETE /admin/agents/:id
   * Eliminar agente. Si tiene referidos, solo desactiva; si no, elimina.
   */
  deleteAgent: async (req, res) => {
    try {
      const { id } = req.params;

      const agent = await Agent.findById(id);
      if (!agent) return sendResponse(res, 404, null, "Agente no encontrado");

      const hasReferrals = await Organization.exists({ referredByAgent: id });

      if (hasReferrals) {
        agent.status = "inactive";
        await agent.save();
        return sendResponse(res, 200, agent, "Agente desactivado (tiene referidos asociados)");
      }

      await Agent.deleteOne({ _id: id });
      return sendResponse(res, 200, null, "Agente eliminado");
    } catch (err) {
      console.error("[agentController.deleteAgent]", err.message);
      return sendResponse(res, 500, null, "Error al eliminar agente");
    }
  },

  /**
   * GET /admin/agents/:id/referrals
   * Organizaciones referidas por el agente, con estado de membresía.
   */
  getAgentReferrals: async (req, res) => {
    try {
      const { id } = req.params;

      const agent = await Agent.findById(id).lean();
      if (!agent) return sendResponse(res, 404, null, "Agente no encontrado");

      const orgs = await Organization.find({ referredByAgent: id })
        .select("name slug email membershipStatus referredAt convertedToPayingAt createdAt")
        .sort({ referredAt: -1 })
        .lean();

      return sendResponse(res, 200, { agent, referrals: orgs });
    } catch (err) {
      console.error("[agentController.getAgentReferrals]", err.message);
      return sendResponse(res, 500, null, "Error al obtener referidos");
    }
  },
};

export default agentController;
