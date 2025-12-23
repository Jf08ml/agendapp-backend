// services/membershipService.js
import membershipModel from "../models/membershipModel.js";
import organizationModel from "../models/organizationModel.js";
import planModel from "../models/planModel.js";
import notificationModel from "../models/notificationModel.js";

const membershipService = {
  /**
   * Crear una nueva membresía para una organización
   */
  createMembership: async ({ organizationId, planId, startDate, trialDays = 0 }) => {
    const plan = await planModel.findById(planId);
    if (!plan) throw new Error("Plan no encontrado");

    const start = startDate ? new Date(startDate) : new Date();
    const periodEnd = new Date(start);
    
    // Por defecto, período mensual
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const membership = await membershipModel.create({
      organizationId,
      planId,
      startDate: start,
      currentPeriodStart: start,
      currentPeriodEnd: periodEnd,
      nextPaymentDue: periodEnd,
      status: trialDays > 0 ? "trial" : "active",
      trialEnd: trialDays > 0 ? new Date(start.getTime() + trialDays * 24 * 60 * 60 * 1000) : null,
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
   * Obtener membresía activa de una organización
   */
  getActiveMembership: async (organizationId) => {
    return await membershipModel
      .findOne({
        organizationId,
        status: { $in: ["active", "trial", "grace_period"] },
      })
      .populate("planId")
      .sort({ createdAt: -1 });
  },

  /**
   * Verificar y actualizar estado de membresías que están por vencer
   * Retorna las membresías que necesitan notificaciones
   */
  checkExpiringMemberships: async () => {
    const now = new Date();
    const threeDaysFromNow = new Date(now);
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    // Buscar membresías activas que vencen en los próximos 3 días
    const expiring = await membershipModel
      .find({
        status: { $in: ["active", "trial"] },
        currentPeriodEnd: { $lte: threeDaysFromNow, $gte: now },
        "notifications.threeDaysSent": false,
      })
      .populate("organizationId planId");

    const results = {
      threeDays: [],
      oneDay: [],
      expired: [],
      gracePeriod: [],
      toSuspend: [],
    };

    for (const membership of expiring) {
      const daysLeft = membership.daysUntilExpiration();

      // 3 días antes
      if (daysLeft <= 3 && daysLeft > 1 && !membership.notifications.threeDaysSent) {
        results.threeDays.push(membership);
        membership.notifications.threeDaysSent = true;
        await membership.save();
      }

      // 1 día antes
      if (daysLeft <= 1 && daysLeft > 0 && !membership.notifications.oneDaySent) {
        results.oneDay.push(membership);
        membership.notifications.oneDaySent = true;
        await membership.save();
      }

      // Día de vencimiento
      if (daysLeft <= 0 && daysLeft > -1 && !membership.notifications.expirationSent) {
        results.expired.push(membership);
        membership.status = "grace_period";
        membership.notifications.expirationSent = true;
        await membership.save();
        
        // Actualizar organización
        await organizationModel.findByIdAndUpdate(membership.organizationId._id, {
          membershipStatus: "grace_period",
        });
      }

      // Período de gracia (día 1 y 2 después de vencer)
      if (daysLeft < -1) {
        const graceDays = Math.abs(daysLeft) - 1;
        
        if (graceDays === 1 && !membership.notifications.gracePeriodDay1Sent) {
          results.gracePeriod.push({ membership, day: 1 });
          membership.notifications.gracePeriodDay1Sent = true;
          await membership.save();
        }
        
        if (graceDays === 2 && !membership.notifications.gracePeriodDay2Sent) {
          results.gracePeriod.push({ membership, day: 2 });
          membership.notifications.gracePeriodDay2Sent = true;
          await membership.save();
        }

        // Después de 2 días de gracia, suspender
        if (graceDays > 2 && membership.status !== "suspended") {
          results.toSuspend.push(membership);
        }
      }
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
   * Reactivar una membresía suspendida
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
    
    // Reset notificaciones
    membership.notifications = {
      threeDaysSent: false,
      oneDaySent: false,
      expirationSent: false,
      gracePeriodDay1Sent: false,
      gracePeriodDay2Sent: false,
    };

    await membership.save();

    // Desbloquear organización
    await organizationModel.findByIdAndUpdate(membership.organizationId, {
      membershipStatus: "active",
      hasAccessBlocked: false,
    });

    return membership;
  },

  /**
   * Renovar membresía (registrar pago)
   */
  renewMembership: async (membershipId, paymentAmount) => {
    const membership = await membershipModel.findById(membershipId);
    if (!membership) throw new Error("Membresía no encontrada");

    const now = new Date();
    const newPeriodEnd = new Date(membership.currentPeriodEnd);
    
    // Si ya venció, empezar desde hoy
    if (membership.currentPeriodEnd < now) {
      membership.currentPeriodStart = now;
      newPeriodEnd.setTime(now.getTime());
    }
    
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

    membership.currentPeriodEnd = newPeriodEnd;
    membership.nextPaymentDue = newPeriodEnd;
    membership.lastPaymentDate = now;
    membership.lastPaymentAmount = paymentAmount;
    membership.status = "active";
    
    // Reset notificaciones
    membership.notifications = {
      threeDaysSent: false,
      oneDaySent: false,
      expirationSent: false,
      gracePeriodDay1Sent: false,
      gracePeriodDay2Sent: false,
    };

    await membership.save();

    // Actualizar organización
    await organizationModel.findByIdAndUpdate(membership.organizationId, {
      membershipStatus: "active",
      hasAccessBlocked: false,
    });

    return membership;
  },

  /**
   * Crear notificación en el sistema para el admin/organización
   * Las notificaciones de membresía van SOLO al admin (organización)
   * No se notifica a empleados individuales
   */
  createMembershipNotification: async ({ organizationId, type, daysLeft, membership }) => {
    const messages = {
      "3_days_warning": `⚠️ Tu membresía vence en ${daysLeft} días. Renueva para mantener tu acceso sin interrupciones.`,
      "1_day_warning": `🔔 ¡Importante! Tu membresía vence mañana. Renueva hoy para evitar la suspensión del servicio.`,
      "expired": `⏰ Tu membresía ha vencido. Tienes 2 días hábiles para renovar antes de que se suspenda tu acceso.`,
      "grace_period_1": `⚠️ Día 1/2 del período de gracia. Renueva hoy para mantener tu acceso activo.`,
      "grace_period_2": `🚨 Último día del período de gracia. Si no renuevas hoy, tu acceso será suspendido.`,
      "suspended": `❌ Tu membresía ha sido suspendida por falta de pago. Contacta a soporte para reactivar tu cuenta.`,
    };

    const plan = await planModel.findById(membership.planId);
    const message = messages[type] || "Actualización de membresía";

    // Crear notificación usando el modelo existente
    // Las notificaciones de membresía NO tienen employeeId (son para el admin/organización)
    return await notificationModel.create({
      title: "Estado de Membresía",
      message: message,
      organizationId: organizationId,
      employeeId: null, // null = notificación para el admin/organización
      status: "unread",
      type: "membership", // Tipo específico para notificaciones de membresía
      frontendRoute: "/my-membership", // Ruta donde se verá la notificación
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
    
    return ["active", "trial", "grace_period"].includes(membership.status);
  },

  /**
   * Obtener todas las membresías (admin)
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
   * Actualizar cualquier campo de una membresía (superadmin)
   */
  updateMembership: async (membershipId, updates) => {
    const membership = await membershipModel.findById(membershipId);
    if (!membership) throw new Error("Membresía no encontrada");

    // Campos permitidos para actualizar
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

    // Actualizar solo campos permitidos
    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        membership[key] = updates[key];
      }
    });

    // Si se actualiza el período, recalcular nextPaymentDue
    if (updates.currentPeriodEnd) {
      membership.nextPaymentDue = updates.currentPeriodEnd;
    }

    await membership.save();

    // Actualizar el estado en la organización si cambió
    if (updates.status) {
      await organizationModel.findByIdAndUpdate(membership.organizationId, {
        membershipStatus: updates.status,
        hasAccessBlocked: updates.status === 'suspended',
      });
    }

    return membership.populate('organizationId planId');
  },
};

export default membershipService;
