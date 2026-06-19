// services/membershipService.js
import membershipModel from "../models/membershipModel.js";
import organizationModel from "../models/organizationModel.js";
import planModel from "../models/planModel.js";
import notificationModel from "../models/notificationModel.js";

/**
 * Construye los campos a resetear en la org cuando cambia a un plan con menos features.
 * Solo resetea lo que el nuevo plan NO permite — no toca lo que sí está incluido.
 */
function buildPlanResetFields(plan) {
  const limits = plan.limits || {};
  const reset = {};

  if (!limits.professionalLanding) {
    reset.homeLayout = "modern";
  }
  if (!limits.autoConfirmations) {
    reset.reservationPolicy = "manual";
  }
  if (!limits.loyaltyProgram) {
    reset.showLoyaltyProgram = false;
  }
  if (!limits.customBranding) {
    // Limpiar branding personalizado → frontend cae en defaults de AgenditApp
    reset["branding.logoUrl"] = null;
    reset["branding.faviconUrl"] = null;
    reset["branding.pwaIcon"] = null;
    reset["branding.primaryColor"] = null;
    reset["branding.themeColor"] = null;
    reset["branding.footerTextColor"] = null;
    reset["branding.fontFamily"] = "inter";
  }

  return reset;
}

const membershipService = {
  /**
   * Crear una nueva membresía para una organización
   */
  createMembership: async ({ organizationId, planId, startDate, trialDays = 0 }) => {
    const plan = await planModel.findById(planId);
    if (!plan) throw new Error("Plan no encontrado");

    const start = startDate ? new Date(startDate) : new Date();
    const periodEnd = new Date(start);

    if (trialDays > 0) {
      periodEnd.setDate(periodEnd.getDate() + trialDays);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    const membership = await membershipModel.create({
      organizationId,
      planId,
      startDate: start,
      currentPeriodStart: start,
      currentPeriodEnd: periodEnd,
      nextPaymentDue: periodEnd,
      status: trialDays > 0 ? "trial" : "active",
      trialEnd: trialDays > 0 ? periodEnd : null,
    });

    // Actualizar organización
    await organizationModel.findByIdAndUpdate(organizationId, {
      currentMembershipId: membership._id,
      membershipStatus: membership.status,
      hasAccessBlocked: false,
    });

    return membership;
  },

  /**
   * Obtener la membresía actual de una organización (cualquier estado relevante).
   * Usada por el middleware para decidir bloqueo.
   * Incluye suspended para poder mostrar mensajes claros.
   */
  getCurrentMembership: async (organizationId) => {
    return await membershipModel
      .findOne({
        organizationId,
        status: { $in: ["active", "trial", "past_due", "suspended"] },
      })
      .populate("planId")
      .sort({ createdAt: -1 });
  },

  /**
   * Obtener membresía activa (solo estados con acceso: trial, active, past_due).
   * Usada para lógica de negocio donde se necesita "tiene acceso?"
   */
  getActiveMembership: async (organizationId) => {
    return await membershipModel
      .findOne({
        organizationId,
        status: { $in: ["active", "trial", "past_due"] },
      })
      .populate("planId")
      .sort({ createdAt: -1 });
  },

  /**
   * Convierte una membresía de trial vencida al plan gratuito permanente.
   * Se llama automáticamente desde checkExpiringMemberships.
   *
   * Actualiza la MISMA membresía in-place (no crea una segunda): el documento de
   * trial pasa a apuntar al plan gratuito y queda activo. Antes se creaba una
   * membresía nueva y la vieja quedaba huérfana en "expired" → 2 docs por org.
   *
   * @param {Object|string} membershipOrOrgId  el doc de membresía (preferido) o,
   *        por compatibilidad, un organizationId (se busca su membresía actual).
   */
  convertTrialToFree: async (membershipOrOrgId) => {
    const freePlan = await planModel.findOne({ slug: "plan-gratuito", isActive: true });
    if (!freePlan) throw new Error("[convertTrialToFree] plan-gratuito no encontrado en BD");

    // Resolver la membresía a actualizar.
    let membership = membershipOrOrgId;
    if (!membership || !membership._id || typeof membership.save !== "function") {
      // Recibimos un organizationId (o algo no-documento): buscar su membresía actual.
      const organizationId = membership?._id || membership;
      const org = await organizationModel.findById(organizationId).select("currentMembershipId");
      membership = org?.currentMembershipId
        ? await membershipModel.findById(org.currentMembershipId)
        : await membershipModel.findOne({ organizationId }).sort({ createdAt: -1 });
      if (!membership) throw new Error(`[convertTrialToFree] No se encontró membresía para org ${organizationId}`);
    }

    const organizationId = membership.organizationId?._id || membership.organizationId;

    // Actualizar la membresía existente al plan gratuito (permanente).
    membership.planId = freePlan._id;
    membership.status = "active";
    membership.currentPeriodStart = new Date();
    membership.currentPeriodEnd = null; // permanente, sin vencimiento
    membership.nextPaymentDue = null;
    membership.autoRenew = false;
    membership.lastCheckedAt = new Date();
    await membership.save();

    await organizationModel.findByIdAndUpdate(organizationId, {
      currentMembershipId: membership._id,
      membershipStatus: "active",
      hasAccessBlocked: false,
      ...buildPlanResetFields(freePlan),
    });

    console.log(`[convertTrialToFree] Org ${organizationId} convertida a plan gratuito (membresía ${membership._id} actualizada in-place)`);
    return membership;
  },

  /**
   * Verificar y actualizar estado de membresías que están por vencer.
   * IDEMPOTENTE: usa lastCheckedAt para no re-procesar el mismo día.
   * - Membresías trial (plan-demo) que vencen → se convierten a plan-gratuito
   * - Membresías de planes pagos que vencen → flujo normal past_due → suspended
   */
  checkExpiringMemberships: async () => {
    const now = new Date();
    const threeDaysFromNow = new Date(now);
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    // Para trials vencidos: buscar hasta 60 días atrás (por si el cron no corrió varios días)
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const idempotencyFilter = {
      $or: [
        { lastCheckedAt: { $lt: startOfToday } },
        { lastCheckedAt: { $exists: false } },
        { lastCheckedAt: null },
      ],
    };

    // Buscar en dos grupos: trials vencidos (ventana amplia) + planes pagos (ventana ±3 días)
    const [expiredTrials, expiringPaid] = await Promise.all([
      membershipModel
        .find({
          status: "trial",
          currentPeriodEnd: { $lte: now, $gte: sixtyDaysAgo },
          ...idempotencyFilter,
        })
        .populate("organizationId planId"),
      membershipModel
        .find({
          status: { $in: ["active", "past_due"] },
          currentPeriodEnd: { $lte: threeDaysFromNow, $gte: threeDaysAgo },
          ...idempotencyFilter,
        })
        .populate("organizationId planId"),
    ]);

    // Deduplicar por _id (por si algún documento aparece en ambas consultas)
    const seen = new Set();
    const expiring = [...expiredTrials, ...expiringPaid].filter((m) => {
      const id = m._id.toString();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const results = {
      threeDays: [],
      oneDay: [],
      expired: [],
      convertedToFree: [],
      pastDuePeriod: [],
      toSuspend: [],
    };

    for (const membership of expiring) {
      const daysLeft = membership.daysUntilExpiration();
      const isTrial = membership.status === "trial";
      const isTrialPlan = membership.planId?.slug === "plan-demo";

      // 3 días antes de vencer — notificación con tono diferente si es trial
      if (daysLeft <= 3 && daysLeft > 1 && !membership.notifications.threeDaysSent) {
        results.threeDays.push(membership);
        membership.notifications.threeDaysSent = true;
      }

      // 1 día antes de vencer
      if (daysLeft <= 1 && daysLeft > 0 && !membership.notifications.oneDaySent) {
        results.oneDay.push(membership);
        membership.notifications.oneDaySent = true;
      }

      // Trial de plan-demo vencido → convertir a plan gratuito (sin importar cuántos días hace)
      // Actualiza la MISMA membresía in-place (no crea otra).
      if (daysLeft <= 0 && isTrial && isTrialPlan) {
        try {
          await membershipService.convertTrialToFree(membership);
          results.convertedToFree.push(membership);
          continue;
        } catch (err) {
          console.error("[checkExpiring] Error convirtiendo trial a free:", err.message);
          // Fallback: dejar caer al bloque past_due
        }
      }

      // Día de vencimiento (planes pagos): transición a past_due
      // daysLeft === 0 con Math.floor significa entre 0 y 24h restantes
      if (daysLeft === 0 && !isTrial && membership.status !== "past_due") {
        // Planes pagos que vencen → past_due (3 días de gracia, solo lectura)
        results.expired.push(membership);
        membership.status = "past_due";
        membership.notifications.expirationSent = true;

        await organizationModel.findByIdAndUpdate(membership.organizationId._id, {
          membershipStatus: "past_due",
        });
      }

      // Período past_due (día 1 y 2 después de vencer)
      if (daysLeft <= -1 && membership.status === "past_due") {
        const pastDueDays = Math.abs(daysLeft);

        if (pastDueDays === 1 && !membership.notifications.pastDueDay1Sent) {
          results.pastDuePeriod.push({ membership, day: 1 });
          membership.notifications.pastDueDay1Sent = true;
        }

        if (pastDueDays === 2 && !membership.notifications.pastDueDay2Sent) {
          results.pastDuePeriod.push({ membership, day: 2 });
          membership.notifications.pastDueDay2Sent = true;
        }

        // Después de 3 días de past_due → suspender
        if (pastDueDays >= 3) {
          results.toSuspend.push(membership);
        }
      }

      // Marcar como procesado hoy
      membership.lastCheckedAt = now;
      await membership.save();
    }

    return results;
  },

  /**
   * Suspender una membresía y bloquear acceso
   */
  suspendMembership: async (membershipId, reason = "Falta de pago") => {
    const membership = await membershipModel.findById(membershipId);
    if (!membership) throw new Error("Membresía no encontrada");

    membership.status = "suspended";
    membership.suspendedAt = new Date();
    membership.suspensionReason = reason;
    await membership.save();

    // Bloquear acceso a la organización
    await organizationModel.findByIdAndUpdate(membership.organizationId, {
      membershipStatus: "suspended",
      hasAccessBlocked: true,
    });

    return membership;
  },

  /**
   * Activar plan pagado. Función única para activar membresías post-pago.
   * Usada tanto por webhooks externos como por confirmación manual.
   */
  activatePaidPlan: async ({ organizationId, planId, paymentAmount, subscriptionId, paymentMode }) => {
    const plan = await planModel.findById(planId);
    if (!plan) throw new Error("Plan no encontrado");

    // Buscar membresía existente (cualquier estado)
    let membership = await membershipModel
      .findOne({ organizationId })
      .sort({ createdAt: -1 });

    const now = new Date();
    const newPeriodEnd = new Date(now);
    const cycleMonths = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12, lifetime: 120 };
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + (cycleMonths[plan.billingCycle] ?? 1));

    if (membership) {
      // Actualizar membresía existente
      membership.status = "active";
      membership.planId = planId;
      membership.currentPeriodStart = now;
      membership.currentPeriodEnd = newPeriodEnd;
      membership.nextPaymentDue = newPeriodEnd;
      membership.lastPaymentDate = now;
      membership.lastPaymentAmount = paymentAmount || 0;
      membership.suspendedAt = null;
      membership.suspensionReason = "";
      membership.notifications = {
        threeDaysSent: false,
        oneDaySent: false,
        expirationSent: false,
        pastDueDay1Sent: false,
        pastDueDay2Sent: false,
      };
      membership.lastCheckedAt = null;
      if (subscriptionId !== undefined) membership.paypalSubscriptionId = subscriptionId || null;
      if (paymentMode !== undefined) membership.paymentMode = paymentMode || null;
      if (paymentMode === "subscription") membership.autoRenew = true;
      if (paymentMode === "once") membership.autoRenew = false;
      await membership.save();
    } else {
      // Crear nueva
      membership = await membershipModel.create({
        organizationId,
        planId,
        startDate: now,
        currentPeriodStart: now,
        currentPeriodEnd: newPeriodEnd,
        nextPaymentDue: newPeriodEnd,
        status: "active",
        lastPaymentDate: now,
        lastPaymentAmount: paymentAmount || 0,
        paypalSubscriptionId: subscriptionId || null,
        paymentMode: paymentMode || null,
        autoRenew: paymentMode === "subscription",
      });
    }

    // Sincronizar organización y resetear features que el nuevo plan no incluye
    const orgUpdate = {
      currentMembershipId: membership._id,
      membershipStatus: "active",
      hasAccessBlocked: false,
      ...buildPlanResetFields(plan),
    };
    await organizationModel.findByIdAndUpdate(organizationId, orgUpdate);

    // Registrar primera conversión a pago si la org tiene agente referidor
    await organizationModel.updateOne(
      { _id: organizationId, referredByAgent: { $ne: null }, convertedToPayingAt: null },
      { $set: { convertedToPayingAt: new Date() } }
    );

    return membership;
  },

  /**
   * Reactivar una membresía suspendida (legacy, para uso desde superadmin)
   */
  reactivateMembership: async (membershipId, newPeriodEnd) => {
    const membership = await membershipModel.findById(membershipId);
    if (!membership) throw new Error("Membresía no encontrada");

    const now = new Date();
    membership.status = "active";
    membership.currentPeriodStart = now;
    membership.currentPeriodEnd = newPeriodEnd || new Date(now.setMonth(now.getMonth() + 1));
    membership.nextPaymentDue = membership.currentPeriodEnd;
    membership.lastPaymentDate = new Date();
    membership.suspendedAt = null;
    membership.suspensionReason = "";

    membership.notifications = {
      threeDaysSent: false,
      oneDaySent: false,
      expirationSent: false,
      pastDueDay1Sent: false,
      pastDueDay2Sent: false,
    };
    membership.lastCheckedAt = null;

    await membership.save();

    await organizationModel.findByIdAndUpdate(membership.organizationId, {
      membershipStatus: "active",
      hasAccessBlocked: false,
    });

    return membership;
  },

  /**
   * Renovar membresía (registrar pago) — usado por superadmin
   */
  renewMembership: async (membershipId, paymentAmount) => {
    const membership = await membershipModel.findById(membershipId).populate("planId");
    if (!membership) throw new Error("Membresía no encontrada");

    const now = new Date();
    const cycleMonths = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12, lifetime: 120 };
    const months = cycleMonths[membership.planId?.billingCycle] ?? 1;

    let newPeriodEnd;

    if (membership.currentPeriodEnd < now) {
      membership.currentPeriodStart = now;
      newPeriodEnd = new Date(now);
      newPeriodEnd.setMonth(newPeriodEnd.getMonth() + months);
    } else {
      newPeriodEnd = new Date(membership.currentPeriodEnd);
      newPeriodEnd.setMonth(newPeriodEnd.getMonth() + months);
    }

    membership.currentPeriodEnd = newPeriodEnd;
    membership.nextPaymentDue = newPeriodEnd;
    membership.lastPaymentDate = now;
    membership.lastPaymentAmount = paymentAmount;
    membership.status = "active";

    membership.notifications = {
      threeDaysSent: false,
      oneDaySent: false,
      expirationSent: false,
      pastDueDay1Sent: false,
      pastDueDay2Sent: false,
    };
    membership.lastCheckedAt = null;

    await membership.save();

    await organizationModel.findByIdAndUpdate(membership.organizationId, {
      membershipStatus: "active",
      hasAccessBlocked: false,
    });

    return membership;
  },

  /**
   * Crear notificación en el sistema para el admin/organización
   */
  createMembershipNotification: async ({ organizationId, type, daysLeft, membership }) => {
    const messages = {
      "3_days_warning": `⚠️ Tu membresía vence en ${daysLeft} días. Renueva para mantener tu acceso sin interrupciones.`,
      "1_day_warning": `🔔 ¡Importante! Tu membresía vence mañana. Renueva hoy para evitar la suspensión del servicio.`,
      "expired": `⏰ Tu membresía ha vencido. Tienes 3 días para renovar antes de que se suspenda tu acceso. Durante este período solo podrás consultar tus datos.`,
      "past_due_1": `⚠️ Día 1/3 de gracia. Tu acceso es solo lectura. Renueva hoy para recuperar el acceso completo.`,
      "past_due_2": `🚨 Día 2/3 de gracia. Si no renuevas pronto, tu acceso será suspendido.`,
      "suspended": `❌ Tu membresía ha sido suspendida por falta de pago. Contacta a soporte para reactivar tu cuenta.`,
    };

    const message = messages[type] || "Actualización de membresía";

    return await notificationModel.create({
      title: "Estado de Membresía",
      message: message,
      organizationId: organizationId,
      employeeId: null,
      status: "unread",
      type: "membership",
      frontendRoute: "/my-membership",
    });
  },

  /**
   * Verificar si una organización tiene acceso activo
   */
  hasActiveAccess: async (organizationId) => {
    const org = await organizationModel.findById(organizationId);
    if (!org) return false;

    if (org.hasAccessBlocked) return false;

    const membership = await membershipService.getActiveMembership(organizationId);
    if (!membership) return false;

    return ["active", "trial", "past_due"].includes(membership.status);
  },

  /**
   * Obtener todas las membresías (superadmin)
   */
  getAllMemberships: async (filters = {}) => {
    const query = {};

    if (filters.status) query.status = filters.status;
    if (filters.planId) query.planId = filters.planId;

    return await membershipModel
      .find(query)
      .populate("organizationId planId")
      .sort({ createdAt: -1 });
  },

  /**
   * Cambiar plan de una membresía
   */
  changePlan: async (membershipId, newPlanId) => {
    const membership = await membershipModel.findById(membershipId);
    if (!membership) throw new Error("Membresía no encontrada");

    const newPlan = await planModel.findById(newPlanId);
    if (!newPlan) throw new Error("Plan no encontrado");

    membership.planId = newPlanId;
    await membership.save();

    return membership;
  },

  /**
   * Obtener una membresía por su ID (populate org y plan)
   */
  getMembershipById: async (membershipId) => {
    return membershipModel
      .findById(membershipId)
      .populate("organizationId", "_id name email slug")
      .populate("planId");
  },

  /**
   * Actualizar cualquier campo de una membresía (superadmin).
   * Sincroniza organización, resetea notifications y actualiza currentMembershipId.
   */
  updateMembership: async (membershipId, updates) => {
    const membership = await membershipModel.findById(membershipId);
    if (!membership) throw new Error("Membresía no encontrada");

    const allowedFields = [
      'planId',
      'status',
      'currentPeriodStart',
      'currentPeriodEnd',
      'lastPaymentDate',
      'lastPaymentAmount',
      'autoRenew',
      'adminNotes',
      'nextPaymentDue',
    ];

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        membership[key] = updates[key];
      }
    });

    if (updates.currentPeriodEnd) {
      membership.nextPaymentDue = updates.currentPeriodEnd;
    }

    // Resetear notificaciones cuando se cambia estado o fechas
    if (updates.status || updates.currentPeriodEnd) {
      membership.notifications = {
        threeDaysSent: false,
        oneDaySent: false,
        expirationSent: false,
        pastDueDay1Sent: false,
        pastDueDay2Sent: false,
      };
      membership.lastCheckedAt = null;
    }

    await membership.save();

    // Sincronizar organización si cambió el status o el plan
    if (updates.status || updates.planId) {
      const orgUpdate = {
        currentMembershipId: membership._id,
      };
      if (updates.status) {
        orgUpdate.membershipStatus = updates.status;
        orgUpdate.hasAccessBlocked = ["suspended", "cancelled"].includes(updates.status);
      }
      await organizationModel.findByIdAndUpdate(membership.organizationId, orgUpdate);
    }

    return membership.populate('organizationId planId');
  },

  /**
   * Obtiene los límites del plan activo de una organización.
   */
  getPlanLimits: async (organizationId) => {
    try {
      const membership = await membershipModel
        .findOne({
          organizationId,
          status: { $in: ["active", "trial", "past_due"] },
        })
        .populate("planId", "limits slug name displayName")
        .sort({ createdAt: -1 })
        .lean();

      return membership?.planId?.limits || null;
    } catch (error) {
      console.error("[getPlanLimits] Error:", error.message);
      return null;
    }
  },
};

export default membershipService;
