import Organization from "../models/organizationModel.js";
import bcrypt from "bcryptjs";
import membershipService from "./membershipService.js";
import Plan from "../models/planModel.js";
import Service from "../models/serviceModel.js";
import Employee from "../models/employeeModel.js";
import { sendTemplateMessage } from "./metaApiService.js";
import { normalizePhone } from "./waAgentService.js";
import { getVerticalCatalog } from "../utils/verticalCatalogs.js";

// Monedas de denominación grande (sin centavos en la práctica): los precios
// de ejemplo se multiplican ×1000 para que se vean realistas (ej: $40.000 COP vs $40 USD)
const LARGE_DENOMINATION_CURRENCIES = new Set([
  "COP", "CLP", "CRC", "PYG", "ARS", "HUF", "KRW", "IDR", "VND", "UYU", "NIO",
]);

const organizationService = {
  // Crear una nueva organización
  createOrganization: async (organizationData) => {
    const {
      name,
      iconUrl,
      email,
      location,
      address,
      password,
      phoneNumber,
      role,
      instagramUrl,
      facebookUrl,
      whatsappUrl,
      tiktokUrl,
      isActive,
      referredCount,
      referredReward,
      serviceCount,
      serviceReward,
      openingHours,
      plan,
      clientIdWhatsapp,
      reservationPolicy,
      default_country,
      timezone,
      currency,
    } = organizationData;

    // Encriptar la contraseña antes de guardarla
    const hashedPassword = await bcrypt.hash(password, 10);

    const newOrganization = new Organization({
      name,
      iconUrl,
      email,
      location,
      address,
      password: hashedPassword,
      phoneNumber,
      role,
      isActive,
      instagramUrl,
      facebookUrl,
      whatsappUrl,
      tiktokUrl,
      referredCount: referredCount || 0,
      referredReward: referredReward || null,
      serviceCount: serviceCount || 0,
      serviceReward: serviceReward || null,
      openingHours: openingHours || { start: null, end: null },
      plan,
      clientIdWhatsapp,
      branding: organizationData.branding || {},
      domains: organizationData.domains || [],
      reservationPolicy:
        reservationPolicy === "auto_if_available"
          ? "auto_if_available"
          : "manual",
      default_country: default_country || 'CO', // 🌍 País por defecto
      timezone: timezone || undefined,
      currency: currency || undefined,
    });

    const savedOrganization = await newOrganization.save();

    // Crear trial automático de 7 días
    try {
      const trialPlan = await Plan.findOne({ slug: "plan-demo", isActive: true });
      if (trialPlan) {
        await membershipService.createMembership({
          organizationId: savedOrganization._id,
          planId: trialPlan._id,
          trialDays: 7,
        });
      }
    } catch (err) {
      console.error("[createOrganization] Error creando trial automático:", err.message);
      // No fallar la creación de org si el trial falla
    }

    // Ocultar el campo password antes de devolver la organización creada
    savedOrganization.password = undefined;
    return savedOrganization;
  },

  // Obtener todas las organizaciones
  getOrganizations: async () => {
    return await Organization.find()
      .select("-password")
      .populate("role")
      .exec();
  },

  // Obtener una organización por ID
  getOrganizationById: async (id) => {
    const organization = await Organization.findById(id)
      .select("-password")
      .populate("role");
    if (!organization) {
      throw new Error("Organización no encontrada");
    }
    return organization;
  },

  // Actualizar una organización
  updateOrganization: async (id, organizationData) => {
    const {
      name,
      iconUrl,
      email,
      location,
      address,
      password,
      phoneNumber,
      role,
      instagramUrl,
      facebookUrl,
      whatsappUrl,
      tiktokUrl,
      isActive,
      referredCount,
      referredReward,
      serviceCount,
      serviceReward,
      serviceTiers,
      referralTiers,
      openingHours,
      weeklySchedule,
      plan,
      clientIdWhatsapp,
      branding,
      domain,
      domains,
      reservationPolicy,
      showLoyaltyProgram,
      enableOnlineBooking,
      enableClassBooking,
      setupCompleted,
      welcomeTitle,
      welcomeDescription,
      homeLayout,
      reminderSettings,
      paymentMethods,
      requireReservationDeposit,
      reservationDepositPercentage,
      requireClassDeposit,
      classDepositPercentage,
      depositPreferredMethod,
      default_country,
      timezone,
      currency,
      timeFormat,
      cancellationPolicy,
      blockHolidaysForReservations,
      allowedHolidayDates,
      hasAccessBlocked,
      clientFormConfig,
      storeFormConfig,
      termsAndConditions,
      waPhone,
      waAgentEnabled,
      waBookingAgentEnabled,
      waConnectionType,
      metaPhoneNumberId,
      metaPhone,
      autoMarkAttended,
      aiAssistantName,
      storeEnabled,
      storeCodEnabled,
    } = organizationData;

    const organization = await Organization.findById(id);

    if (!organization) {
      throw new Error("Organización no encontrada");
    }

    // Actualizar los campos que se proporcionen en la solicitud
    organization.name = name !== undefined ? name : organization.name;
    organization.iconUrl =
      iconUrl !== undefined ? iconUrl : organization.iconUrl;
    organization.email = email !== undefined ? email : organization.email;
    organization.location =
      location !== undefined ? location : organization.location;
    organization.address =
      address !== undefined ? address : organization.address;
    organization.phoneNumber =
      phoneNumber !== undefined ? phoneNumber : organization.phoneNumber;
    organization.role = role !== undefined ? role : organization.role;
    organization.instagramUrl =
      instagramUrl !== undefined ? instagramUrl : organization.instagramUrl;
    organization.facebookUrl =
      facebookUrl !== undefined ? facebookUrl : organization.facebookUrl;
    organization.whatsappUrl =
      whatsappUrl !== undefined ? whatsappUrl : organization.whatsappUrl;
    organization.tiktokUrl =
      tiktokUrl !== undefined ? tiktokUrl : organization.tiktokUrl;
    organization.isActive =
      isActive !== undefined ? isActive : organization.isActive;

    organization.referredCount =
      referredCount !== undefined ? referredCount : organization.referredCount;
    organization.referredReward =
      referredReward !== undefined
        ? referredReward
        : organization.referredReward;
    organization.serviceCount =
      serviceCount !== undefined ? serviceCount : organization.serviceCount;
    organization.serviceReward =
      serviceReward !== undefined ? serviceReward : organization.serviceReward;
    organization.serviceTiers =
      serviceTiers !== undefined ? serviceTiers : organization.serviceTiers;
    organization.referralTiers =
      referralTiers !== undefined ? referralTiers : organization.referralTiers;
    if (openingHours !== undefined) {
      organization.openingHours = {
        ...(organization.openingHours?.toObject?.() ??
          organization.openingHours),
        ...openingHours,
      };
    }

    if (weeklySchedule !== undefined) {
      organization.weeklySchedule = {
        ...(organization.weeklySchedule?.toObject?.() ??
          organization.weeklySchedule),
        ...weeklySchedule,
      };
    }

    organization.plan = plan !== undefined ? plan : organization.plan;
    organization.clientIdWhatsapp =
      clientIdWhatsapp !== undefined
        ? clientIdWhatsapp
        : organization.clientIdWhatsapp;

    if (branding) {
      organization.branding = {
        ...organization.branding,
        ...branding,
      };
    }

    if (domains !== undefined) {
      organization.domains = Array.isArray(domains) ? domains : [domains];
    } else if (domain !== undefined) {
      organization.domains = Array.isArray(domain) ? domain : [domain];
    }

    if (reservationPolicy !== undefined) {
      if (!["manual", "auto_if_available"].includes(reservationPolicy)) {
        throw new Error("reservationPolicy inválida");
      }
      organization.reservationPolicy = reservationPolicy;
    }

    if (showLoyaltyProgram !== undefined) {
      organization.showLoyaltyProgram = showLoyaltyProgram;
    }

    if (enableOnlineBooking !== undefined) {
      organization.enableOnlineBooking = enableOnlineBooking;
    }

    if (enableClassBooking !== undefined) {
      organization.enableClassBooking = enableClassBooking;
    }

    if (setupCompleted !== undefined) {
      organization.setupCompleted = setupCompleted;
      // 📊 Instrumentación: marcar cuándo completó el setup (una sola vez)
      if (setupCompleted) {
        if (!organization.onboardingMilestones) organization.onboardingMilestones = {};
        organization.onboardingMilestones.setupCompletedAt =
          organization.onboardingMilestones.setupCompletedAt || new Date();
      }
    }

    if (welcomeTitle !== undefined) {
      organization.welcomeTitle = welcomeTitle;
    }

    if (welcomeDescription !== undefined) {
      organization.welcomeDescription = welcomeDescription;
    }

    if (homeLayout !== undefined) {
      organization.homeLayout = homeLayout;
    }

    if (reminderSettings !== undefined) {
      organization.reminderSettings = {
        ...organization.reminderSettings,
        ...reminderSettings,
      };
    }

    if (paymentMethods !== undefined) {
      organization.paymentMethods = paymentMethods;
    }

    if (requireReservationDeposit !== undefined) {
      organization.requireReservationDeposit = requireReservationDeposit;
    }

    if (reservationDepositPercentage !== undefined) {
      organization.reservationDepositPercentage = reservationDepositPercentage;
    }

    if (requireClassDeposit !== undefined) {
      organization.requireClassDeposit = requireClassDeposit;
    }

    if (depositPreferredMethod !== undefined) {
      organization.depositPreferredMethod = depositPreferredMethod;
    }

    if (classDepositPercentage !== undefined) {
      organization.classDepositPercentage = classDepositPercentage;
    }

    // 🌍 Actualizar país por defecto
    if (default_country !== undefined) {
      organization.default_country = default_country;
    }

    // 🕐 Actualizar zona horaria si se proporciona
    if (timezone !== undefined) {
      organization.timezone = timezone;
    }

    // 💱 Actualizar moneda si se proporciona
    if (currency !== undefined) {
      organization.currency = currency;
    }

    // 🕐 Actualizar formato de hora si se proporciona
    if (timeFormat !== undefined) {
      organization.timeFormat = timeFormat;
    }

    // 🤖 Actualizar nombre del agente IA si se proporciona
    if (aiAssistantName !== undefined) {
      organization.aiAssistantName = aiAssistantName?.trim() || "Roxi";
    }

    // 🚫 Actualizar política de cancelación si se proporciona
    if (cancellationPolicy !== undefined) {
      organization.cancellationPolicy = {
        ...organization.cancellationPolicy,
        ...cancellationPolicy,
      };
    }

    // 📅 Bloqueo de festivos para reservas online
    if (blockHolidaysForReservations !== undefined) {
      organization.blockHolidaysForReservations = blockHolidaysForReservations;
    }

    if (allowedHolidayDates !== undefined) {
      organization.allowedHolidayDates = allowedHolidayDates;
    }

    // 📄 Términos y condiciones
    if (termsAndConditions !== undefined) {
      organization.termsAndConditions = {
        ...organization.termsAndConditions,
        ...termsAndConditions,
      };
    }

    // 📋 Configuración del formulario de cliente
    if (clientFormConfig !== undefined) {
      organization.clientFormConfig = {
        identifierField: clientFormConfig.identifierField ?? organization.clientFormConfig?.identifierField ?? 'phone',
        fields: Array.isArray(clientFormConfig.fields) ? clientFormConfig.fields : organization.clientFormConfig?.fields ?? [],
      };
    }

    // 🛍️ Configuración del formulario de comprador en la tienda pública (independiente de clientFormConfig)
    if (storeFormConfig !== undefined) {
      organization.storeFormConfig = {
        identifierField: storeFormConfig.identifierField ?? organization.storeFormConfig?.identifierField ?? 'phone',
        fields: Array.isArray(storeFormConfig.fields) ? storeFormConfig.fields : organization.storeFormConfig?.fields ?? [],
      };
    }

    // 🔒 Bloqueo de acceso (superadmin)
    if (hasAccessBlocked !== undefined) {
      organization.hasAccessBlocked = hasAccessBlocked;
    }

    // 🤖 Agente WA (Baileys)
    if (waPhone !== undefined) organization.waPhone = waPhone || null;
    if (waAgentEnabled !== undefined) {
      const activandoAgente = waAgentEnabled === true && organization.waAgentEnabled !== true;
      organization.waAgentEnabled = waAgentEnabled;

      if (activandoAgente) {
        console.log("[WaAgent] Activando agente — phoneNumber:", organization.phoneNumber, "| waAgentEnabled anterior:", !activandoAgente);
        if (organization.phoneNumber) {
          const adminPhone = normalizePhone(organization.phoneNumber);
          console.log("[WaAgent] Enviando agente_ia_activo a:", adminPhone);
          sendTemplateMessage(adminPhone, "agente_ia_activo")
            .then(() => console.log("[WaAgent] agente_ia_activo enviado OK a:", adminPhone))
            .catch((err) => console.error("[WaAgent] Error enviando agente_ia_activo:", err?.response?.data || err.message));
        } else {
          console.warn("[WaAgent] No se envió agente_ia_activo — org sin phoneNumber");
        }
      }
    }

    // 🤖 Agente IA de reservas para clientes (número Meta de la org)
    if (waBookingAgentEnabled !== undefined) organization.waBookingAgentEnabled = !!waBookingAgentEnabled;

    // ✅ Auto-marcar asistencia
    if (autoMarkAttended !== undefined) organization.autoMarkAttended = autoMarkAttended;

    // 🛍️ Tienda pública de productos (flags del toggle en /inventario)
    if (storeEnabled !== undefined) organization.storeEnabled = !!storeEnabled;
    if (storeCodEnabled !== undefined) organization.storeCodEnabled = !!storeCodEnabled;

    // 🔗 Conexión híbrida WA (Meta/Baileys)
    if (waConnectionType !== undefined) organization.waConnectionType = waConnectionType;
    if (metaPhoneNumberId !== undefined) organization.metaPhoneNumberId = metaPhoneNumberId || null;
    if (metaPhone !== undefined) organization.metaPhone = metaPhone || null;

    // Encriptar la contraseña solo si se proporciona una nueva
    if (password) {
      organization.password = await bcrypt.hash(password, 10);
    }

    const updatedOrganization = await organization.save();

    // Popular el campo 'role'
    await updatedOrganization.populate("role");

    // Ocultar la contraseña antes de devolver
    updatedOrganization.password = undefined;
    return updatedOrganization;
  },

  // Eliminar una organización
  deleteOrganization: async (id) => {
    const organization = await Organization.findById(id);
    if (!organization) {
      throw new Error("Organización no encontrada");
    }

    await Organization.deleteOne({ _id: id });
    return { message: "Organización eliminada correctamente" };
  },

  // Datos de ejemplo para "Explorar primero": crea servicios y profesionales demo,
  // activa el horario semanal por defecto y marca el setup como completado, para que
  // el usuario aterrice en una agenda funcional en lugar de un checklist vacío.
  // Solo opera sobre organizaciones sin servicios ni profesionales (no duplica).
  seedDemoData: async (organizationId) => {
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw new Error("Organización no encontrada");
    }

    const [serviceCount, employeeCount] = await Promise.all([
      Service.countDocuments({ organizationId }),
      Employee.countDocuments({ organizationId }),
    ]);

    if (serviceCount > 0 || employeeCount > 0) {
      // Ya tiene datos reales: no sembrar nada, solo dejar entrar
      if (!organization.setupCompleted) {
        organization.setupCompleted = true;
        if (!organization.onboardingMilestones) organization.onboardingMilestones = {};
        organization.onboardingMilestones.setupCompletedAt =
          organization.onboardingMilestones.setupCompletedAt || new Date();
        await organization.save();
      }
      return { seeded: false, services: [], employees: [] };
    }

    const multiplier = LARGE_DENOMINATION_CURRENCIES.has(organization.currency) ? 1000 : 1;
    // Catálogo según el rubro elegido en el registro (fallback a "otro")
    const catalog = getVerticalCatalog(organization.businessVertical);
    const demoServices = catalog.services.map((s) => ({
      name: s.name,
      type: s.type,
      duration: s.duration,
      price: s.price * multiplier,
      ...(s.maxConcurrentAppointments && { maxConcurrentAppointments: s.maxConcurrentAppointments }),
      description: "Servicio de ejemplo — edítalo o elimínalo cuando quieras.",
    }));
    const createdServices = await Service.insertMany(
      demoServices.map((s) => ({ ...s, organizationId }))
    );
    const serviceIds = createdServices.map((s) => s._id);

    // Contraseña aleatoria + correo placeholder no-login: los demo no acceden a la plataforma
    const randomPassword = await bcrypt.hash(
      Math.random().toString(36).slice(-10) + "A1!",
      10
    );
    const ts = Date.now().toString(36);
    const position = catalog.position;
    const demoEmployees = [
      { names: "Ana Ejemplo", position, color: "#7B68EE", email: `demo-ana-${ts}@sin-acceso.agenditapp.com` },
      { names: "Carlos Ejemplo", position, color: "#98FB98", email: `demo-carlos-${ts}@sin-acceso.agenditapp.com` },
    ];
    const createdEmployees = await Employee.insertMany(
      demoEmployees.map((e) => ({
        ...e,
        phoneNumber: "+10000000000",
        password: randomPassword,
        services: serviceIds,
        organizationId,
      }))
    );

    // Activar el horario semanal por defecto del modelo (L-V 8-20, Sáb 8-14)
    organization.weeklySchedule = {
      ...(organization.weeklySchedule?.toObject?.() || organization.weeklySchedule || {}),
      enabled: true,
    };
    organization.setupCompleted = true;
    // 📊 Instrumentación del funnel
    if (!organization.onboardingMilestones) organization.onboardingMilestones = {};
    const now = new Date();
    organization.onboardingMilestones.setupCompletedAt =
      organization.onboardingMilestones.setupCompletedAt || now;
    organization.onboardingMilestones.seededDemoAt =
      organization.onboardingMilestones.seededDemoAt || now;
    await organization.save();

    return {
      seeded: true,
      services: createdServices.map((s) => ({ id: s._id, name: s.name })),
      employees: createdEmployees.map((e) => ({ id: e._id, names: e.names })),
    };
  },
};

export default organizationService;
